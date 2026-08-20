const fs = require('fs');
const path = require('path');

let Redis = null;
try {
  Redis = require('@upstash/redis').Redis;
} catch (e) {
  Redis = null; // package not installed — fine, local file mode still works
}

// If UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are set, use Upstash's
// free-tier Redis as the datastore. This is the recommended setup for hosts
// with an ephemeral filesystem (Render/Railway free & hobby tiers) since it
// needs no paid disk. Otherwise, fall back to a local JSON file — simplest
// for local development, and still fine on a host with real persistent disk.
const USE_REDIS = Boolean(
  Redis && process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
);

const REDIS_RECORDS_KEY = 'event_registrations:records';
const REDIS_NEXT_ID_KEY = 'event_registrations:next_id';
// Screenshots are stored one-per-key instead of inside the records array.
// This is the fix for the "max request size exceeded" error: the array
// written on every registration would otherwise grow to include every
// base64-encoded screenshot ever uploaded, in a single Redis SET command.
const redisScreenshotKey = (id) => `event_registrations:screenshot:${id}`;

const redis = USE_REDIS ? Redis.fromEnv() : null;

// DATA_DIR can be overridden via env var to point at a persistent disk/volume
// mount path on hosts that have one. Defaults to ./data. Unused entirely
// when USE_REDIS is true.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'registrations.json');
// Local-file backend: screenshots go in their own folder, one file per id,
// instead of inline in registrations.json — same reasoning as the Redis
// per-key split above (keeps the main JSON file small and fast to rewrite).
const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');
const localScreenshotFile = (id) => path.join(SCREENSHOTS_DIR, `${id}.txt`);

if (USE_REDIS) {
  console.log('[storage] Using Upstash Redis for persistent storage.');
} else {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  console.log(
    '[storage] Using local JSON file at ' +
      DATA_FILE +
      ' (set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN to use Redis instead — required on hosts with an ephemeral filesystem).'
  );
}

// Every read-modify-write goes through this single promise chain so two
// requests arriving at nearly the same instant can never race and silently
// drop each other's record — true for both the file and Redis backends.
let queue = Promise.resolve();
function serialized(fn) {
  const result = queue.then(fn);
  queue = result.catch(() => {}); // one failed op must not wedge the queue
  return result;
}

async function readAllRaw() {
  if (USE_REDIS) {
    const data = await redis.get(REDIS_RECORDS_KEY);
    return Array.isArray(data) ? data : [];
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf8') || '[]';
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

async function writeAllRaw(records) {
  if (USE_REDIS) {
    await redis.set(REDIS_RECORDS_KEY, records);
    return;
  }
  await new Promise((resolve, reject) => {
    fs.writeFile(DATA_FILE, JSON.stringify(records, null, 2), 'utf8', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function saveScreenshot(id, screenshotDataUrl) {
  if (!screenshotDataUrl) return;
  if (USE_REDIS) {
    await redis.set(redisScreenshotKey(id), screenshotDataUrl);
    return;
  }
  await new Promise((resolve, reject) => {
    fs.writeFile(localScreenshotFile(id), screenshotDataUrl, 'utf8', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function loadScreenshot(id) {
  if (USE_REDIS) {
    const data = await redis.get(redisScreenshotKey(id));
    return typeof data === 'string' ? data : null;
  }
  try {
    return fs.readFileSync(localScreenshotFile(id), 'utf8');
  } catch (e) {
    return null;
  }
}

// Simple 1, 2, 3... registration numbers.
// - Redis backend: an atomic INCR, so it stays correct even if this ever
//   runs as more than one instance.
// - File backend: computed once from disk on first use, then incremented
//   in memory (fine because every call is serialized through `queue`).
let nextLocalId = null;
function nextLocalIdSync() {
  if (nextLocalId === null) {
    const raw = fs.readFileSync(DATA_FILE, 'utf8') || '[]';
    let records = [];
    try {
      records = JSON.parse(raw);
    } catch (e) {
      records = [];
    }
    nextLocalId = records.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
  }
  return nextLocalId++;
}

async function addRecord(record) {
  return serialized(async () => {
    const id = USE_REDIS ? await redis.incr(REDIS_NEXT_ID_KEY) : nextLocalIdSync();

    // Split the screenshot off before it ever touches the records array —
    // this is what keeps every future write of the array small and fast,
    // regardless of how many registrations (or how large their screenshots)
    // pile up.
    const { screenshot, ...recordWithoutScreenshot } = record;
    const withId = { id, ...recordWithoutScreenshot };

    const records = await readAllRaw();
    records.push(withId);
    await writeAllRaw(records);

    if (screenshot) {
      await saveScreenshot(id, screenshot);
    }

    return withId;
  });
}

async function getConfirmedRecords() {
  const records = await readAllRaw();
  return records.filter((r) => r.status === 'confirmed').sort((a, b) => a.id - b.id);
}

async function getById(id) {
  const records = await readAllRaw();
  const record = records.find((r) => String(r.id) === String(id));
  if (!record) return null;

  // Screenshot is fetched on demand rather than kept on every record in
  // memory/array form — only callers that actually need the image (the
  // admin screenshot viewer) pay the cost of loading it.
  const screenshot = await loadScreenshot(record.id);
  return screenshot ? { ...record, screenshot } : record;
}

async function readAll() {
  return readAllRaw();
}

module.exports = {
  addRecord,
  getConfirmedRecords,
  getById,
  readAll,
};