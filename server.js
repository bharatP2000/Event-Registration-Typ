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
const ADMIN_EXPORT_KEY = process.env.ADMIN_EXPORT_KEY || 'change-me-please';
const EVENT_AREAS = (process.env.EVENT_AREAS || 'North Zone,South Zone,East Zone,West Zone,Central')
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

const MOBILE_REGEX = /^[6-9]\d{9}$/; // Indian 10-digit mobile numbers

// ---- Public config (no secrets) so the frontend can render the form ----
app.get('/api/config', (req, res) => {
  res.json({
    eventName: EVENT_NAME,
    eventDate: EVENT_DATE,
    eventTime: EVENT_TIME,
    feeInr: EVENT_FEE_INR,
    areas: EVENT_AREAS,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  });
});

// ---- Step 1: form submit + order creation happen together (atomic) ----
// The registration record is created in the same request that creates the
// Razorpay order, so there is no separate "save form" step before payment.
app.post('/api/register', async (req, res) => {
  try {
    const { name, mobile, area } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Please enter a valid name.' });
    }
    if (!mobile || !MOBILE_REGEX.test(String(mobile).trim())) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }
    if (!area || !EVENT_AREAS.includes(area)) {
      return res.status(400).json({ error: 'Please select a valid area.' });
    }

    const amountPaise = Math.round(EVENT_FEE_INR * 100);

    const order = await razorpay.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt: `reg_${Date.now()}`,
      notes: { name: name.trim(), mobile: mobile.trim(), area },
    });

    await storage.addRecord({
      name: name.trim(),
      mobile: mobile.trim(),
      area,
      amount_inr: EVENT_FEE_INR,
      razorpay_order_id: order.id,
      razorpay_payment_id: null,
      status: 'created', // created -> paid (only 'paid' rows are exported)
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
    res.status(500).json({ error: 'Could not start payment. Please try again.' });
  }
});

// ---- Step 2: verify payment signature and mark registration as paid ----
app.post('/api/verify', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details.' });
    }

    const existing = storage.getByOrderId(razorpay_order_id);
    if (!existing) {
      return res.status(404).json({ error: 'Registration not found for this order.' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification failed. Please contact support.' });
    }

    const updated = await storage.updateRecordByOrderId(razorpay_order_id, {
      status: 'paid',
      razorpay_payment_id,
      paid_at: new Date().toISOString(),
    });

    res.json({ success: true, registration: updated });
  } catch (err) {
    console.error('verify error:', err);
    res.status(500).json({ error: 'Could not verify payment.' });
  }
});

// ---- Excel export of confirmed (paid) registrations ----
app.get('/api/export', async (req, res) => {
  try {
    if (req.query.key !== ADMIN_EXPORT_KEY) {
      return res.status(403).send('Forbidden: invalid or missing export key.');
    }

    const records = storage.getPaidRecords();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Registrations');

    sheet.columns = [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Mobile No', key: 'mobile', width: 16 },
      { header: 'Area', key: 'area', width: 20 },
      { header: 'Amount (INR)', key: 'amount_inr', width: 14 },
      { header: 'Payment ID', key: 'razorpay_payment_id', width: 26 },
      { header: 'Order ID', key: 'razorpay_order_id', width: 26 },
      { header: 'Paid At', key: 'paid_at', width: 24 },
    ];
    sheet.getRow(1).font = { bold: true };

    records.forEach((r) => sheet.addRow(r));

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="registrations-${Date.now()}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('export error:', err);
    res.status(500).send('Could not generate export.');
  }
});

app.listen(PORT, () => {
  console.log(`Event registration server running at http://localhost:${PORT}`);
});
