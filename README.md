# Event Registration (UPI QR + screenshot upload)

A minimal, single-page event registration site. There is no payment
gateway: the visitor fills in the form, scans a **static UPI QR code**
shown on the page to pay, uploads a **screenshot of that payment**, and
the registration is saved as `confirmed` the moment the form is submitted
— all in one request.

## What's inside

```
event-registration/
├── server.js          Express server: registration + screenshot upload, Excel export
├── storage.js          Tiny JSON-file / Redis datastore (swap for a real DB if you need scale)
├── package.json
├── .env.example         Copy to .env and fill in your keys
├── data/
│   └── registrations.json   Created automatically on first run
└── public/
    ├── index.html       The registration page
    ├── admin.html        Admin dashboard (view/search/export registrations)
    ├── style.css        Styling (ticket-stub design), incl. background-image fallback
    ├── app.js            Frontend logic
    └── assets/
        ├── background.jpg   ← event photo (optional)
        └── payment-qr.jpeg   ← your UPI QR code image
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

- `UPI_ID` / `UPI_PAYEE_NAME` — shown as text under the QR code, in case
  someone prefers to type the UPI ID manually. The QR code image itself
  (`public/assets/payment-qr.jpeg`) is what people actually scan — replace
  that file with your own QR export from Google Pay / PhonePe / any UPI app.
- `EVENT_FEE_INR` — registration fee in rupees, e.g. `499`.
- `EVENT_NAME` — shown as the page heading.
- `EVENT_AREAS` — comma-separated list for the Area dropdown.
- `ADMIN_EXPORT_KEY` — a private key you make up; required to view the
  admin dashboard, view screenshots, and download the Excel export. Treat
  it like a password.
- `EVENT_DATE` / `EVENT_TIME` — shown under the event name on the page.
- `EVENT_GUIDANCE` / `EVENT_ORGANIZER` / `EVENT_TAGLINE` — optional lines
  shown above and below the form (leave any of them blank to hide it).

## 3. Add your QR code and background image

- Replace `public/assets/payment-qr.jpeg` with your own UPI QR code image
  (export it from your UPI app's "Receive money" / "My QR code" screen).
- Optionally drop an event photo at `public/assets/background.jpg`. If you
  skip this, the page falls back to a plain gradient — nothing breaks.

## 4. Run

```bash
npm start
```

Visit `http://localhost:3000`.

## How the flow works

1. Visitor fills in **name, mobile number, area, Member Of**, scans the
   UPI QR code shown on the page with any UPI app, and pays the fee.
2. They upload a **screenshot of the successful payment** and tap
   **Submit Registration**.
3. The browser sends everything — form fields + screenshot — to
   `POST /api/register` in one multipart request. The server validates the
   fields, checks the screenshot is an image under 5 MB, and saves the
   registration with `status: "confirmed"` immediately. There is no
   separate verification step — a human (you) reviews screenshots after
   the fact via the admin dashboard if you want to catch mistakes.
4. The confirmation screen shows the registration number right away.

The screenshot is stored **inside the registration record itself** (as
base64), not as a separate file on disk — so it persists through whichever
storage backend you're using (Redis or the local JSON file) without needing
a separate uploads folder or persistent volume just for images.

## Reviewing screenshots / admin dashboard

Visit `/admin` and enter your `ADMIN_EXPORT_KEY`. You can search, filter by
area/Member Of, and click **View** on any row to open that registration's
payment screenshot in a new tab (also gated behind the admin key).

## Exporting registrations to Excel

```
GET /api/export?key=YOUR_ADMIN_EXPORT_KEY
```

Open that URL in a browser (or
`curl -o registrations.xlsx "http://localhost:3000/api/export?key=..."`)
and it downloads an `.xlsx` file with every confirmed registration:
registration number, name, mobile, area, Member Of, amount, a link to that
registration's screenshot, and the registration timestamp.

## Registration numbers

Every registration gets a simple sequential number (1, 2, 3, ...) the
moment it's created, stored as `id` on the record. It's assigned in memory
when the server starts (continuing from the highest existing id in
`data/registrations.json`) and handed out synchronously, so two people
registering at the same instant never collide.

## Deploying

This is a plain Node/Express app, so it runs as-is on Render, Railway,
Fly.io, a VPS, etc. Set all the `.env` values as real environment
variables on your host before deploying.

### ⚠️ Persistent storage — read this before you deploy

By default this app saves registrations (including screenshots, embedded
as base64) to a local JSON file (`data/registrations.json`). **Render and
Railway both give services an ephemeral filesystem by default** — any file
written during normal operation is silently wiped on the next redeploy or
restart (and on Render's free tier, also whenever the service spins down
from inactivity and wakes back up). If you skip this step, registrations
will appear to save, then vanish.

#### Option A — free tier: Upstash Redis (recommended, works on Render/Railway free tiers)

`storage.js` automatically switches to [Upstash](https://console.upstash.com)
Redis whenever its two env vars are set — no other code changes needed.
Upstash's free tier is 256 MB — since screenshots are now stored inline,
a busy event can use this up faster than plain text records would; keep an
eye on your Upstash dashboard usage if you expect a large turnout.

1. Sign up at https://console.upstash.com and create a Redis database
   (any region close to your host is fine).
2. On the database's dashboard, copy the **REST URL** and **REST TOKEN**.
3. Add them to your host's environment variables:
   ```
   UPSTASH_REDIS_REST_URL=https://xxxxx.upstash.io
   UPSTASH_REDIS_REST_TOKEN=xxxxxxxxxxxx
   ```
4. Redeploy. Your server log will print `Using Upstash Redis for
   persistent storage.` on startup — check your host's logs to confirm.
5. Verify it's really working: submit one real test registration (with a
   dummy screenshot), then open `/admin` and confirm it shows up. Restart
   the service (or wait for a free-tier spin-down/wake-up) and refresh
   `/admin` again — the record should still be there.

If these env vars are left blank, the app quietly falls back to the local
JSON file — handy for local development, but do **not** deploy without
setting them on a host with an ephemeral filesystem.

#### Option B — paid tier: a persistent disk/volume

If you're on a paid Render or Railway plan, you can skip Upstash and mount
real disk instead:

**Render:** Service → **Disks** → **Add Disk** (Starter plan or above —
Free services can't attach disks at all) → set a mount path, e.g.
`/var/data` → add env var `DATA_DIR=/var/data` → redeploy.

**Railway:** Service → **Volumes** → **New Volume** (Hobby/Pro plan) → set
a mount path, e.g. `/data` → add env var `DATA_DIR=/data` → redeploy.

`storage.js` uses the JSON file at `DATA_DIR` whenever the Upstash vars
above aren't set, so this and Option A never conflict — just pick one.

## Security notes

- Nobody's payment is programmatically verified — this flow trusts a human
  to glance over screenshots via `/admin`, the same way a manual UPI-QR
  collection at a physical stall would work. It's meant for a small
  community event, not a storefront.
- The admin dashboard, screenshot viewer, and Excel export are all gated
  behind `ADMIN_EXPORT_KEY`. For anything beyond a small one-off event, put
  these endpoints behind proper auth instead.
- Screenshots can contain personal UPI/bank app details — treat exports and
  the admin key with the same care as the registrations themselves.
