require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const Razorpay = require('razorpay');
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

const EVENT_AREAS = (
  process.env.EVENT_AREAS ||
  'North Zone,South Zone,East Zone,West Zone,Central'
)
  .split(',')
  .map((a) => a.trim())
  .filter(Boolean);

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
  console.warn(
    '[warning] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set. Copy .env.example to .env and fill in your keys.'
  );
}

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

const MOBILE_REGEX = /^[6-9]\d{9}$/;
const MEMBER_OF_OPTIONS = ['TYP', 'TKM'];

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
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  });
});

// ---- Step 1: Create registration + Razorpay order ----
app.post('/api/register', async (req, res) => {
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

    const amountPaise = Math.round(EVENT_FEE_INR * 100);

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `reg_${Date.now()}`,
      notes: {
        name: name.trim(),
        mobile: mobile.trim(),
        area,
        memberOf,
      },
    });

    await storage.addRecord({
      name: name.trim(),
      mobile: mobile.trim(),
      area,
      memberOf,
      amount_inr: EVENT_FEE_INR,
      razorpay_order_id: order.id,
      razorpay_payment_id: null,
      status: 'created',
      created_at: new Date().toISOString(),
      paid_at: null,
    });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      eventName: EVENT_NAME,
    });
  } catch (err) {
    console.error('register error:', err);

    res.status(500).json({
      error: 'Could not start payment. Please try again.',
    });
  }
});

// ---- Step 2: Verify payment ----
app.post('/api/verify', async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body || {};

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        error: 'Missing payment details.',
      });
    }

    const existing = await storage.getByOrderId(razorpay_order_id);

    if (!existing) {
      return res.status(404).json({
        error: 'Registration not found for this order.',
      });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({
        error: 'Payment verification failed. Please contact support.',
      });
    }

    const updated = await storage.updateRecordByOrderId(
      razorpay_order_id,
      {
        status: 'paid',
        razorpay_payment_id,
        paid_at: new Date().toISOString(),
      }
    );

    res.json({
      success: true,
      registration: updated,
    });
  } catch (err) {
    console.error('verify error:', err);

    res.status(500).json({
      error: 'Could not verify payment.',
    });
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

    const records = await storage.getPaidRecords();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Registrations');

    sheet.columns = [
      { header: 'Reg. No.', key: 'id', width: 10 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Mobile No', key: 'mobile', width: 16 },
      { header: 'Area', key: 'area', width: 20 },
      { header: 'Member Of', key: 'memberOf', width: 14 },
      { header: 'Amount (INR)', key: 'amount_inr', width: 14 },
      { header: 'Payment ID', key: 'razorpay_payment_id', width: 26 },
      { header: 'Order ID', key: 'razorpay_order_id', width: 26 },
      { header: 'Paid At', key: 'paid_at', width: 24 },
    ];

    sheet.getRow(1).font = {
      bold: true,
    };

    records.forEach((r) => {
      sheet.addRow(r);
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

// ---- Admin: JSON data for the dashboard (all statuses, not just paid) ----
app.get('/api/admin/registrations', async (req, res) => {
  if (req.query.key !== ADMIN_EXPORT_KEY) {
    return res.status(403).json({ error: 'Forbidden: invalid or missing admin key.' });
  }

  try {
    const records = (await storage.readAll()).sort((a, b) => b.id - a.id);
    const paid = records.filter((r) => r.status === 'paid');

    res.json({
      eventName: EVENT_NAME,
      total: records.length,
      paidCount: paid.length,
      pendingCount: records.length - paid.length,
      totalRevenue: paid.reduce((sum, r) => sum + (Number(r.amount_inr) || 0), 0),
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

app.listen(PORT, () => {
  console.log(
    `Event registration server running at http://localhost:${PORT}`
  );
});