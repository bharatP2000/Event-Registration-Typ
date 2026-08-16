# Event Registration (with Razorpay)

A minimal, single-page event registration site. Registration and payment
happen in **one atomic step**: the form data and the Razorpay order are
created together in one request, the checkout opens immediately, and the
signup is only recorded as confirmed once payment is verified. There is no
"fill form, come back later to pay" flow.

## What's inside

```
event-registration/
├── server.js          Express server: order creation, payment verification, Excel export
├── storage.js          Tiny JSON-file datastore (swap for a real DB if you need scale)
├── package.json
├── .env.example         Copy to .env and fill in your keys
├── data/
│   └── registrations.json   Created automatically on first run
└── public/
    ├── index.html       The registration page
    ├── style.css        Styling (ticket-stub design), incl. background-image fallback
    ├── app.js            Frontend logic
    └── assets/
        └── background.jpg   ← put your event photo here (optional)
```

## 1. Install

```bash
npm install
```

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` — from your
  [Razorpay dashboard](https://dashboard.razorpay.com/app/keys). Use the
  `rzp_test_...` keys while developing, switch to live keys for production.
- `EVENT_FEE_INR` — registration fee in rupees, e.g. `499`.
- `EVENT_NAME` — shown as the page heading and in the Razorpay checkout popup.
- `EVENT_AREAS` — comma-separated list for the Area dropdown, e.g.
  `North Zone,South Zone,East Zone,West Zone,Central`.
- `ADMIN_EXPORT_KEY` — a private key you make up; required to download the
  Excel export. Treat it like a password.
- `EVENT_DATE` / `EVENT_TIME` — shown under the event name on the page.
- `EVENT_GUIDANCE` / `EVENT_ORGANIZER` / `EVENT_TAGLINE` — optional lines
  shown above and below the form (leave any of them blank to hide it).
- `EMAIL_USER` / `EMAIL_PASS` / `EMAIL_SERVICE` — for sending the
  confirmation email after payment. Simplest setup is a Gmail address plus
  an **App Password** (not your normal Gmail password) generated at
  https://myaccount.google.com/apppasswords. Leave these blank to skip
  sending emails — registration still works, it just won't email anyone.

## 3. Add a background image (optional)

Drop a photo at `public/assets/background.jpg`. If you skip this, the page
automatically falls back to a plain gradient — nothing breaks, no broken-image
icon, no code changes needed.

## 4. Run

```bash
npm start
```

Visit `http://localhost:3000`.

## How the atomic flow works

1. Visitor fills in **name, mobile number, area** and taps **Register & Pay**.
2. The browser sends that data to `POST /api/register`. The server validates
   it, creates a Razorpay order, **and saves the registration record in the
   same request** (status: `created`). The order ID is handed back.
3. The Razorpay checkout modal opens immediately with that order — the
   visitor never sees a separate "registration submitted" page before paying.
4. On successful payment, the browser calls `POST /api/verify` with the
   payment ID and signature. The server verifies the signature with HMAC
   SHA-256 against your `RAZORPAY_KEY_SECRET` and flips the record's status
   to `paid`.
5. Only `paid` records ever show up in the Excel export — a registration that
   was started but never paid for doesn't count as a signup.

If the visitor closes the checkout without paying, the `created` record just
sits there unpaid; it's harmless and excluded from the export. If you want to
periodically prune abandoned attempts, delete rows with `status: "created"`
from `data/registrations.json` older than a day or so.

## Exporting registrations to Excel

```
GET /api/export?key=YOUR_ADMIN_EXPORT_KEY
```

Open that URL in a browser (or `curl -o registrations.xlsx "http://localhost:3000/api/export?key=..."`)
and it downloads an `.xlsx` file with every paid registration: registration
number, name, mobile, email, area, amount, payment ID, order ID, and paid-at
timestamp.

## Registration numbers

Every registration gets a simple sequential number (1, 2, 3, ...) the moment
it's created, stored as `id` on the record. It's assigned in memory when the
server starts (continuing from the highest existing id in
`data/registrations.json`) and handed out synchronously, so two people
registering at the same instant never collide. This number is shown on the
confirmation screen, included in the confirmation email, and is the first
column in the Excel export.

## Deploying

This is a plain Node/Express app, so it runs as-is on Render, Railway,
Fly.io, a VPS, etc. Two things to remember in production:

- Set all the `.env` values as real environment variables on your host.
- `data/registrations.json` lives on local disk — if your host has an
  ephemeral filesystem (e.g. most serverless platforms), point `storage.js`
  at a real database instead so registrations survive deploys/restarts.
- Switch `RAZORPAY_KEY_ID`/`SECRET` to your live keys only once you're ready
  to take real payments.

## Security notes

- The Razorpay **key secret never reaches the browser** — only the public
  `key_id` is sent to the frontend via `/api/config` / `/api/register`.
- Payment signatures are verified server-side before a registration is ever
  marked paid; the frontend's word alone is never trusted.
- The Excel export is gated behind `ADMIN_EXPORT_KEY`. For anything beyond a
  small one-off event, put this endpoint behind proper auth instead.
