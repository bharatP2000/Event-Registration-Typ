const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'registrations.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');

// Serialize all writes so concurrent requests never corrupt the file.
let writeQueue = Promise.resolve();

function readAll() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8') || '[]';
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeAll(records) {
  writeQueue = writeQueue.then(
    () =>
      new Promise((resolve, reject) => {
        fs.writeFile(DATA_FILE, JSON.stringify(records, null, 2), 'utf8', (err) => {
          if (err) reject(err);
          else resolve();
        });
      })
  );
  return writeQueue;
}

async function addRecord(record) {
  const records = readAll();
  records.push(record);
  await writeAll(records);
  return record;
}

async function updateRecordByOrderId(orderId, patch) {
  const records = readAll();
  const idx = records.findIndex((r) => r.razorpay_order_id === orderId);
  if (idx === -1) return null;
  records[idx] = { ...records[idx], ...patch };
  await writeAll(records);
  return records[idx];
}

function getByOrderId(orderId) {
  const records = readAll();
  return records.find((r) => r.razorpay_order_id === orderId) || null;
}

function getPaidRecords() {
  return readAll().filter((r) => r.status === 'paid');
}

module.exports = {
  addRecord,
  updateRecordByOrderId,
  getByOrderId,
  getPaidRecords,
  readAll,
};
