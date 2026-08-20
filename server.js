require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const ExcelJS = require('exceljs');
const storage = require('./storage');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const EVENT_FEE_INR = Number(process.env.EVENT_FEE_INR || 499);
const EVENT_NAME = process.env.EVENT_NAME || 'Event Registration';
const EVENT_DATE = process.env.EVENT_DATE || '';
const EVENT_TIME = process.env.EVENT_TIME || '';
const EVENT_GUIDANCE = process.env.EVENT_GUIDANCE || '';
const EVENT_ORGANIZER = process.env.EVENT_ORGANIZER || '';
const EVENT_TAGLINE = process.env.EVENT_TAGLINE || '';
const ADMIN_EXPORT_KEY = process.env.ADMIN_EXPORT_KEY || 'change-me-please';
const UPI_ID = process.env.UPI_ID || '';
const UPI_PAYEE_NAME = process.env.UPI_PAYEE_NAME || '';

const EVENT_AREAS = (
  process.env.EVENT_AREAS ||
  'North Zone,South Zone,East Zone,West Zone,Central'
)
  .split(',')
  .map((a) => a.trim())
  .filter(Boolean);

const MOBILE_REGEX = /^[6-9]\d{9}$/;
const MEMBER_OF_OPTIONS = ['TYP', 'TKM'];

// Screenshots are kept in memory only long enough to base64-encode them into
// the registration record itself, so they persist through the same storage
// backend (Redis or the local JSON file) as everything else — no separate
// uploads folder that would be lost on redeploy.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are accepted for the payment screenshot.'));
    }
    cb(null, true);
  },
});

// ---- Public config ----
app.get('/api/config', (req, res) => {
  res.json({
    eventName: EVENT_NAME,
    eventDate: EVENT_DATE,
    eventTime: EVENT_TIME,
    eventGuidance: EVENT_GUIDANCE,
    eventOrganizer: EVENT_ORGANIZER,
    eventTagline: EVENT_TAGLINE,
    feeInr: EVENT_FEE_INR,
    areas: EVENT_AREAS,
    memberOfOptions: MEMBER_OF_OPTIONS,
    upiId: UPI_ID,
    upiPayeeName: UPI_PAYEE_NAME,
  });
});

// ---- Register: form fields + payment screenshot, in one step ----
app.post('/api/register', (req, res) => {
  upload.single('screenshot')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({
        error: uploadErr.message || 'Could not process the uploaded screenshot.',
      });
    }

    try {
      const { name, mobile, area, memberOf } = req.body || {};

      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return res.status(400).json({
          error: 'Please enter a valid name.',
        });
      }

      if (!mobile || !MOBILE_REGEX.test(String(mobile).trim())) {
        return res.status(400).json({
          error: 'Please enter a valid 10-digit mobile number.',
        });
      }

      if (!area || !EVENT_AREAS.includes(area)) {
        return res.status(400).json({
          error: 'Please select a valid area.',
        });
      }

      if (!memberOf || !MEMBER_OF_OPTIONS.includes(memberOf)) {
        return res.status(400).json({
          error: 'Please select Member Of.',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: 'Please upload a screenshot of your payment.',
        });
      }

      const screenshotDataUrl =
        `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

      const record = await storage.addRecord({
        name: name.trim(),
        mobile: mobile.trim(),
        area,
        memberOf,
        amount_inr: EVENT_FEE_INR,
        screenshot: screenshotDataUrl,
        status: 'confirmed',
        created_at: new Date().toISOString(),
      });

      res.json({
        success: true,
        registration: {
          id: record.id,
          name: record.name,
          area: record.area,
          memberOf: record.memberOf,
        },
      });
    } catch (err) {
      console.error('register error:', err);
      res.status(500).json({
        error: 'Could not save your registration. Please try again.',
      });
    }
  });
});

// ---- Admin: view a single screenshot ----
app.get('/api/admin/screenshot/:id', async (req, res) => {
  if (req.query.key !== ADMIN_EXPORT_KEY) {
    return res.status(403).send('Forbidden: invalid or missing admin key.');
  }

  try {
    const record = await storage.getById(req.params.id);
    if (!record || !record.screenshot) {
      return res.status(404).send('Screenshot not found.');
    }

    const match = /^data:(.+);base64,(.*)$/.exec(record.screenshot);
    if (!match) return res.status(404).send('Screenshot not found.');

    res.setHeader('Content-Type', match[1]);
    res.send(Buffer.from(match[2], 'base64'));
  } catch (err) {
    console.error('screenshot error:', err);
    res.status(500).send('Could not load screenshot.');
  }
});

// ---- Excel export of confirmed registrations ----
app.get('/api/export', async (req, res) => {
  try {
    if (req.query.key !== ADMIN_EXPORT_KEY) {
      return res.status(403).send(
        'Forbidden: invalid or missing export key.'
      );
    }

    const records = await storage.getConfirmedRecords();
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Registrations');

    sheet.columns = [
      { header: 'Reg. No.', key: 'id', width: 10 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Mobile No', key: 'mobile', width: 16 },
      { header: 'Area', key: 'area', width: 20 },
      { header: 'Member Of', key: 'memberOf', width: 14 },
      { header: 'Amount (INR)', key: 'amount_inr', width: 14 },
      { header: 'Screenshot Link', key: 'screenshot_link', width: 40 },
      { header: 'Registered At', key: 'created_at', width: 24 },
    ];

    sheet.getRow(1).font = {
      bold: true,
    };

    records.forEach((r) => {
      sheet.addRow({
        id: r.id,
        name: r.name,
        mobile: r.mobile,
        area: r.area,
        memberOf: r.memberOf,
        amount_inr: r.amount_inr,
        screenshot_link: `${baseUrl}/api/admin/screenshot/${r.id}?key=${encodeURIComponent(ADMIN_EXPORT_KEY)}`,
        created_at: r.created_at,
      });
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="registrations-${Date.now()}.xlsx"`
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('export error:', err);
    res.status(500).send('Could not generate export.');
  }
});

// ---- Admin: JSON data for the dashboard ----
app.get('/api/admin/registrations', async (req, res) => {
  if (req.query.key !== ADMIN_EXPORT_KEY) {
    return res.status(403).json({ error: 'Forbidden: invalid or missing admin key.' });
  }

  try {
    const all = (await storage.readAll()).sort((a, b) => b.id - a.id);
    const confirmed = all.filter((r) => r.status === 'confirmed');

    // Screenshots are left out of the list payload (they can be large) —
    // the dashboard fetches them individually via /api/admin/screenshot/:id.
    const records = all.map(({ screenshot, ...rest }) => rest);

    res.json({
      eventName: EVENT_NAME,
      total: all.length,
      confirmedCount: confirmed.length,
      totalRevenue: confirmed.reduce((sum, r) => sum + (Number(r.amount_inr) || 0), 0),
      areas: EVENT_AREAS,
      records,
    });
  } catch (err) {
    console.error('admin list error:', err);
    res.status(500).json({ error: 'Could not load registrations.' });
  }
});

// ---- Admin dashboard page ----
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'event-registration',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Event registration server running on port ${PORT}`);
});
