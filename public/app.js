(function () {
  const form = document.getElementById('reg-form');
  const payBtn = document.getElementById('pay-btn');
  const nameInput = document.getElementById('name');
  const mobileInput = document.getElementById('mobile');
  const areaSelect = document.getElementById('area');
  const memberOfSelect = document.getElementById('memberOf');
  const screenshotInput = document.getElementById('screenshot');
  const amountDisplay = document.getElementById('amount-display');
  const upiIdNote = document.getElementById('upi-id-note');
  const qrImage = document.getElementById('qr-image');
  const qrTapHint = document.getElementById('qr-tap-hint');
  const eventNameEl = document.getElementById('event-name');
  const eventGuidanceEl = document.getElementById('event-guidance');
  const eventDatetimeEl = document.getElementById('event-datetime');
  const eventOrganizerEl = document.getElementById('event-organizer');
  const eventTaglineEl = document.getElementById('event-tagline');
  const statusBanner = document.getElementById('status-banner');
  const confirmation = document.getElementById('confirmation');
  const confirmId = document.getElementById('confirm-id');
  const confirmName = document.getElementById('confirm-name');
  const confirmArea = document.getElementById('confirm-area');
  const confirmMemberOf = document.getElementById('confirm-memberOf');

  const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB, matches server limit

  let CONFIG = null;

  function showBanner(message, type) {
    statusBanner.textContent = message;
    statusBanner.className = 'status-banner show ' + type;
  }
  function clearBanner() {
    statusBanner.className = 'status-banner';
  }
  function fieldError(id, message) {
    document.getElementById('err-' + id).textContent = message || '';
  }

  // Builds a standard UPI deep link (upi://pay?...). Any installed UPI app
  // (GPay, PhonePe, Paytm, BHIM, etc.) registers this scheme, so opening it
  // on a phone shows the OS "choose an app" chooser with the amount and
  // payee already filled in.
  function buildUpiUrl(cfg) {
    if (!cfg || !cfg.upiId) return null;
    const params = ['pa=' + encodeURIComponent(cfg.upiId)];
    if (cfg.upiPayeeName) params.push('pn=' + encodeURIComponent(cfg.upiPayeeName));
    const amount = Number(cfg.feeInr);
    if (amount > 0) params.push('am=' + encodeURIComponent(amount.toFixed(2)));
    params.push('cu=INR');
    params.push('tn=' + encodeURIComponent((cfg.eventName || 'Event Registration') + ' registration fee'));
    return 'upi://pay?' + params.join('&');
  }

  // Makes the QR image itself act as a "pay now" trigger on phones that
  // have a UPI app installed. Desktop clicks are harmless no-ops since no
  // app is registered to handle the upi:// scheme there — the QR image
  // still works as a normal scan target either way.
  function setupQrTapToPay(cfg) {
    const upiUrl = buildUpiUrl(cfg);
    if (!upiUrl || !qrImage) return;

    qrImage.style.cursor = 'pointer';
    qrImage.setAttribute('role', 'button');
    qrImage.setAttribute('tabindex', '0');
    qrImage.setAttribute('aria-label', 'Pay with a UPI app');

    const trigger = () => {
      window.location.href = upiUrl;
    };
    qrImage.addEventListener('click', trigger);
    qrImage.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        trigger();
      }
    });

    if (qrTapHint) qrTapHint.style.display = 'block';
  }
  function clearFieldErrors() {
    ['name', 'mobile', 'area', 'memberOf', 'screenshot'].forEach((id) => fieldError(id, ''));
  }

  async function loadConfig() {
    try {
      const res = await fetch('/api/config');
      CONFIG = await res.json();

      eventNameEl.textContent = CONFIG.eventName;

      if (CONFIG.eventGuidance) {
        eventGuidanceEl.textContent = CONFIG.eventGuidance;
        eventGuidanceEl.style.display = 'block';
      }

      if (CONFIG.eventDate || CONFIG.eventTime) {
        eventDatetimeEl.textContent = [CONFIG.eventDate, CONFIG.eventTime].filter(Boolean).join(' \u2022 ');
      }

      if (CONFIG.eventOrganizer) {
        eventOrganizerEl.textContent = CONFIG.eventOrganizer;
      }
      if (CONFIG.eventTagline) {
        eventTaglineEl.textContent = CONFIG.eventTagline;
        eventTaglineEl.style.display = 'block';
      }

      amountDisplay.textContent = '\u20B9' + CONFIG.feeInr;

      if (CONFIG.upiId) {
        upiIdNote.textContent = 'UPI ID: ' + CONFIG.upiId + (CONFIG.upiPayeeName ? ' (' + CONFIG.upiPayeeName + ')' : '');
      }
      setupQrTapToPay(CONFIG);

      areaSelect.innerHTML = '<option value="" disabled selected>Select your area</option>';
      CONFIG.areas.forEach((area) => {
        const opt = document.createElement('option');
        opt.value = area;
        opt.textContent = area;
        areaSelect.appendChild(opt);
      });
    } catch (err) {
      eventNameEl.textContent = 'Event Registration';
      showBanner('Could not reach the server. Please refresh the page.', 'error');
    }
  }

  function validate() {
    clearFieldErrors();
    let ok = true;

    const name = nameInput.value.trim();
    const mobile = mobileInput.value.trim();
    const area = areaSelect.value;
    const memberOf = memberOfSelect.value;
    const screenshotFile = screenshotInput.files && screenshotInput.files[0];

    if (name.length < 2) {
      fieldError('name', 'Please enter your full name.');
      ok = false;
    }

    if (!/^[6-9]\d{9}$/.test(mobile)) {
      fieldError('mobile', 'Enter a valid 10-digit mobile number.');
      ok = false;
    }

    if (!area) {
      fieldError('area', 'Please select an area.');
      ok = false;
    }

    if (!memberOf) {
      fieldError('memberOf', 'Please select Member Of.');
      ok = false;
    }

    if (!screenshotFile) {
      fieldError('screenshot', 'Please upload your payment screenshot.');
      ok = false;
    } else if (!screenshotFile.type.startsWith('image/')) {
      fieldError('screenshot', 'Please upload an image file.');
      ok = false;
    } else if (screenshotFile.size > MAX_SCREENSHOT_BYTES) {
      fieldError('screenshot', 'Image is too large (max 5 MB).');
      ok = false;
    }

    return ok ? { name, mobile, area, memberOf, screenshotFile } : null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    clearBanner();

    const data = validate();
    if (!data) return;

    payBtn.disabled = true;
    payBtn.textContent = 'Submitting\u2026';

    try {
      const formData = new FormData();
      formData.append('name', data.name);
      formData.append('mobile', data.mobile);
      formData.append('area', data.area);
      formData.append('memberOf', data.memberOf);
      formData.append('screenshot', data.screenshotFile);

      const res = await fetch('/api/register', {
        method: 'POST',
        body: formData,
      });
      const result = await res.json();

      if (!res.ok || !result.success) {
        showBanner(result.error || 'Something went wrong. Please try again.', 'error');
        payBtn.disabled = false;
        payBtn.textContent = 'Submit Registration';
        return;
      }

      form.style.display = 'none';
      confirmation.classList.add('show');
      confirmId.textContent = '#' + result.registration.id;
      confirmName.textContent = result.registration.name;
      confirmArea.textContent = result.registration.area;
      confirmMemberOf.textContent = result.registration.memberOf;
    } catch (err) {
      showBanner('Network error. Please check your connection and try again.', 'error');
      payBtn.disabled = false;
      payBtn.textContent = 'Submit Registration';
    }
  }

  form.addEventListener('submit', handleSubmit);
  loadConfig();
})();
