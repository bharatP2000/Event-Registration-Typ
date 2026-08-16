require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const Razorpay = require('razorpay');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
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

// ---- Email (confirmation mail after payment) ----
// Uses Gmail by default (simplest setup: an address + a 16-character App
// Password, not your normal Gmail password). Set EMAIL_SERVICE to something
// else supported by nodemailer, or leave EMAIL_USER/EMAIL_PASS blank to
// skip sending mail entirely (registration still works either way).
let mailTransporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  mailTransporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
} else {
  console.warn('[warning] EMAIL_USER / EMAIL_PASS not set. Confirmation emails will be skipped.');
}

async function sendConfirmationEmail(record) {
  if (!mailTransporter) return;
  try {
    await mailTransporter.sendMail({
      from: `"${EVENT_NAME}" <${process.env.EMAIL_USER}>`,
      to: record.email,
      subject: `You're registered for ${EVENT_NAME} \u2014 Reg. No. ${record.id}`,
      html: `
        <div style="font-family: Georgia, 'Times New Roman', serif; max-width: 480px; margin: 0 auto; border: 1px solid #d8c48f; border-radius: 10px; overflow: hidden;">
          <div style="background: linear-gradient(135deg, #6e1423, #501118); padding: 24px; text-align: center;">
            <div style="color: #e6c672; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 6px;">Registration Confirmed</div>
            <div style="color: #f7f3ea; font-size: 22px; font-weight: bold;">${EVENT_NAME}</div>
          </div>
          <div style="padding: 24px; background: #fdfaf2; color: #2a1a12;">
            <p>Dear ${record.name},</p>
            <p>Your registration is confirmed. We look forward to seeing you there.</p>
            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
              <tr><td style="padding: 6px 0; color: #7a5b2e;">Registration No.</td><td style="padding: 6px 0; text-align: right; font-weight: bold;">#${record.id}</td></tr>
              <tr><td style="padding: 6px 0; color: #7a5b2e;">Date</td><td style="padding: 6px 0; text-align: right;">${EVENT_DATE}</td></tr>
              <tr><td style="padding: 6px 0; color: #7a5b2e;">Time</td><td style="padding: 6px 0; text-align: right;">${EVENT_TIME}</td></tr>
              <tr><td style="padding: 6px 0; color: #7a5b2e;">Area</td><td style="padding: 6px 0; text-align: right;">${record.area}</td></tr>
              <tr><td style="padding: 6px 0; color: #7a5b2e;">Amount Paid</td><td style="padding: 6px 0; text-align: right;">\u20B9${record.amount_inr}</td></tr>
              <tr><td style="padding: 6px 0; color: #7a5b2e;">Payment ID</td><td style="padding: 6px 0; text-align: right; font-size: 12px;">${record.razorpay_payment_id}</td></tr>
            </table>
            <p style="font-size: 13px; color: #7a5b2e;">Please keep this email as your confirmation. See you soon!</p>
          </div>
        </div>
      `,
    });
  } catch (err) {
    // Never let a mail failure break the payment flow -- the registration
    // is already confirmed and paid regardless of whether the email sends.
    console.error('confirmation email error:', err);
  }
}

const MOBILE_REGEX = /^[6-9]\d{9}$/; // Indian 10-digit mobile numbers
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---- Public config (no secrets) so the frontend can render the form ----
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
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || '',
  });
});

// ---- Step 1: form submit + order creation happen together (atomic) ----
// The registration record is created in the same request that creates the
// Razorpay order, so there is no separate "save form" step before payment.
app.post('/api/register', async (req, res) => {
  try {
    const { name, mobile, email, area } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Please enter a valid name.' });
    }
    if (!mobile || !MOBILE_REGEX.test(String(mobile).trim())) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }
    if (!email || !EMAIL_REGEX.test(String(email).trim())) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
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
      email: email.trim(),
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

    // Fire the confirmation email but don't make the visitor wait for it --
    // their payment is already verified and confirmed either way.
    sendConfirmationEmail(updated);

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
      { header: 'Reg. No.', key: 'id', width: 10 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Mobile No', key: 'mobile', width: 16 },
      { header: 'Email', key: 'email', width: 28 },
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
