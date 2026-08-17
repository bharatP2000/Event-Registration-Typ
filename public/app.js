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
  const passBlock = document.getElementById('pass-block');
  const passPreviewImg = document.getElementById('pass-preview-img');
  const passDownloadBtn = document.getElementById('pass-download-btn');
  const passShareBtn = document.getElementById('pass-share-btn');
  const passStatus = document.getElementById('pass-status');

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
      generateEventPass(result.registration);
    } catch (err) {
      showBanner('Network error. Please check your connection and try again.', 'error');
      payBtn.disabled = false;
      payBtn.textContent = 'Submit Registration';
    }
  }

  // ---- Shareable "event pass" (passport/ticket-style image) ----
  // Drawn on a hidden <canvas>, then exported as a PNG blob so it can be
  // previewed inline, downloaded, and handed to the Web Share API.
  let passBlobData = null; // { blob, filename }
  let logoImagePromise = null;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  function wrapLines(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let current = '';
    words.forEach((word) => {
      const test = current ? current + ' ' + word : word;
      if (current && ctx.measureText(test).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    });
    if (current) lines.push(current);
    return lines.length ? lines : [''];
  }

  // Shrinks a single line of text to fit maxWidth, falling back to an
  // ellipsis if it still doesn't fit at the minimum size.
  function fitSingleLine(ctx, text, maxWidth, baseSize, minSize, weight, family) {
    let size = baseSize;
    const fontAt = (s) => weight + ' ' + s + 'px ' + family;
    ctx.font = fontAt(size);
    while (size > minSize && ctx.measureText(text).width > maxWidth) {
      size -= 1;
      ctx.font = fontAt(size);
    }
    let display = text;
    if (ctx.measureText(display).width > maxWidth) {
      while (display.length > 1 && ctx.measureText(display + '\u2026').width > maxWidth) {
        display = display.slice(0, -1);
      }
      display += '\u2026';
    }
    return { size, text: display };
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawDashedDivider(ctx, x1, x2, y, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    ctx.restore();
  }

  // Cuts a circular "punch hole" out of the canvas so the ticket reads as
  // torn along the perforation line, and doubles as film-strip sprocket
  // holes down the ticket's edges. Works because the exported PNG can
  // carry transparency at the holes.
  function punchHole(ctx, cx, cy, r) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Decorative (non-scannable) barcode strip, deterministic per pass so the
  // same registration always renders the same pattern.
  function drawBarcode(ctx, seedText, x, y, width, height, color) {
    let seed = 0;
    for (let i = 0; i < seedText.length; i += 1) seed = (seed * 31 + seedText.charCodeAt(i)) >>> 0;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    ctx.save();
    ctx.fillStyle = color;
    let cx = x;
    while (cx < x + width) {
      const barW = 2 + Math.floor(rand() * 5);
      if (cx + barW > x + width) break;
      if (rand() > 0.32) ctx.fillRect(cx, y, barW, height);
      cx += barW + 2;
    }
    ctx.restore();
  }

  async function generateEventPass(registration) {
    if (!passBlock || !passPreviewImg) return;
    try {
      passStatus.textContent = '';
      const W = 1080;
      const H = 1260;
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');

      if (document.fonts) {
        await Promise.all([
          document.fonts.load('800 64px Fraunces'),
          document.fonts.load('700 40px Fraunces'),
          document.fonts.load('700 20px Inter'),
          document.fonts.load('600 20px Inter'),
          document.fonts.ready,
        ]).catch(() => {});
      }

      if (!logoImagePromise) logoImagePromise = loadImage('assets/image.png').catch(() => null);
      const logoImg = await logoImagePromise;

      const eventName = (CONFIG && CONFIG.eventName) || 'Event Registration';
      const organiser = (CONFIG && CONFIG.eventOrganizer) || '';

      // Background — warm ivory-to-saffron gradient, calm and devotional
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#fff6e5');
      bgGrad.addColorStop(0.55, '#fdecc8');
      bgGrad.addColorStop(1, '#f8dfa6');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      const glow1 = ctx.createRadialGradient(W / 2, 60, 20, W / 2, 60, 640);
      glow1.addColorStop(0, 'rgba(216, 169, 64, 0.14)');
      glow1.addColorStop(1, 'rgba(216, 169, 64, 0)');
      ctx.fillStyle = glow1;
      ctx.fillRect(0, 0, W, H);

      // Two nested borders — simple, elegant, no film-strip detailing
      ctx.strokeStyle = '#c99a3e';
      ctx.lineWidth = 2;
      roundRectPath(ctx, 34, 34, W - 68, H - 68, 26);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(201,154,62,0.5)';
      ctx.lineWidth = 1;
      roundRectPath(ctx, 46, 46, W - 92, H - 92, 20);
      ctx.stroke();

      // Header: logo + soft eyebrow
      let cursorY = 96;
      if (logoImg) {
        const logoW = 100;
        const logoH = logoW * (logoImg.height / logoImg.width);
        ctx.drawImage(logoImg, (W - logoW) / 2, cursorY, logoW, logoH);
        cursorY += logoH + 34;
      }
      ctx.fillStyle = '#a97c2f';
      ctx.font = '700 19px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('Y O U   A R E   I N V I T E D', W / 2, cursorY);
      cursorY += 46;

      // Event name (autofit, wraps up to 2 lines)
      let nameSize = 58;
      let nameLines = [eventName];
      const nameMaxWidth = 820;
      while (nameSize > 32) {
        ctx.font = '800 ' + nameSize + 'px Fraunces, serif';
        nameLines = wrapLines(ctx, eventName, nameMaxWidth);
        if (nameLines.length <= 2 && nameLines.every((l) => ctx.measureText(l).width <= nameMaxWidth)) break;
        nameSize -= 2;
      }
      if (nameLines.length > 2) nameLines = nameLines.slice(0, 2);

      const nameGrad = ctx.createLinearGradient(0, cursorY, 0, cursorY + nameSize * nameLines.length * 1.15);
      nameGrad.addColorStop(0, '#a9631f');
      nameGrad.addColorStop(1, '#7a4413');
      ctx.fillStyle = nameGrad;
      ctx.font = '800 ' + nameSize + 'px Fraunces, serif';
      let nameY = cursorY + nameSize * 0.78;
      nameLines.forEach((line) => {
        ctx.fillText(line, W / 2, nameY);
        nameY += nameSize * 1.12;
      });
      const nameBottom = nameY - nameSize * 1.12 + nameSize * 0.35;

      // सान्निध्य — spiritual guidance line, wraps to fit
      const sannidhyaLabel = '\u0938\u093e\u0928\u094d\u0928\u093f\u0927\u094d\u092f';
      const sannidhyaText =
        '\u092f\u0941\u0917\u092a\u094d\u0930\u0927\u093e\u0928 \u0906\u091a\u093e\u0930\u094d\u092f \u0936\u094d\u0930\u0940 \u092e\u0939\u093e\u0936\u094d\u0930\u092e\u0923 \u091c\u0940 \u0915\u0947 \u0938\u0941\u0936\u093f\u0937\u094d\u092f ' +
        '\u092e\u0941\u0928\u093f \u0936\u094d\u0930\u0940 \u091c\u093f\u0928\u0947\u0936 \u0915\u0941\u092e\u093e\u0930 \u091c\u0940 \u0920\u093e\u0923\u093e -3';
      const devanagariFont = 'Inter, "Noto Sans Devanagari", sans-serif';

      const sannidhyaLabelY = nameBottom + 40;
      ctx.fillStyle = '#a97c2f';
      ctx.font = '700 15px ' + devanagariFont;
      ctx.fillText(sannidhyaLabel, W / 2, sannidhyaLabelY);

      ctx.font = '600 22px ' + devanagariFont;
      const sannidhyaLines = wrapLines(ctx, sannidhyaText, 780);
      ctx.fillStyle = '#6b4a1e';
      let sannidhyaY = sannidhyaLabelY + 36;
      sannidhyaLines.forEach((line) => {
        ctx.fillText(line, W / 2, sannidhyaY);
        sannidhyaY += 30;
      });
      const sannidhyaBottom = sannidhyaY - 30 + 10;

      // "Presented by" credit line
      let creditBottom = sannidhyaBottom;
      if (organiser) {
        const creditY = sannidhyaBottom + 34;
        ctx.fillStyle = '#a97c2f';
        ctx.font = '600 15px Inter, sans-serif';
        ctx.fillText('P R E S E N T E D   B Y', W / 2, creditY);
        const orgFit = fitSingleLine(ctx, organiser, 760, 24, 16, '600', 'Inter, sans-serif');
        ctx.fillStyle = '#6b4a1e';
        ctx.font = '600 ' + orgFit.size + 'px Inter, sans-serif';
        ctx.fillText(orgFit.text, W / 2, creditY + 32);
        creditBottom = creditY + 32;
      }

      const dividerY = creditBottom + 44;
      drawDashedDivider(ctx, 130, W - 130, dividerY, 'rgba(169,124,47,0.35)');

      // Guest name — the centrepiece of the pass
      const guestY = dividerY + 78;
      ctx.fillStyle = '#a97c2f';
      ctx.font = '700 17px Inter, sans-serif';
      ctx.fillText('G U E S T', W / 2, guestY);
      const guestFit = fitSingleLine(ctx, registration.name || '\u2014', 860, 52, 30, '700', 'Fraunces, serif');
      ctx.fillStyle = '#5a3a12';
      ctx.font = '700 ' + guestFit.size + 'px Fraunces, serif';
      ctx.fillText(guestFit.text, W / 2, guestY + 58);

      let afterGuestY = guestY + 96;
      if (registration.area) {
        ctx.fillStyle = '#a9863f';
        ctx.font = '600 18px Inter, sans-serif';
        ctx.fillText('From ' + registration.area, W / 2, afterGuestY);
        afterGuestY += 40;
      }

      const detailDividerY = afterGuestY;
      drawDashedDivider(ctx, 130, W - 130, detailDividerY, 'rgba(169,124,47,0.28)');

      // Simple event details — date/time and venue side by side, no seat/zone grid
      const showtime = [CONFIG && CONFIG.eventDate, CONFIG && CONFIG.eventTime].filter(Boolean).join(' \u2022 ');
      const venue = 'Yogkshem Vihar, Shyam Garden, Salkia School Road, Howrah - 711106';
      let detailY = detailDividerY + 56;

      if (showtime) {
        ctx.fillStyle = '#a97c2f';
        ctx.font = '700 16px Inter, sans-serif';
        ctx.fillText('D A T E   &   T I M E', W / 2, detailY);
        const fit = fitSingleLine(ctx, showtime, 760, 30, 18, '700', 'Fraunces, serif');
        ctx.fillStyle = '#5a3a12';
        ctx.font = '700 ' + fit.size + 'px Fraunces, serif';
        ctx.fillText(fit.text, W / 2, detailY + 38);
        detailY += 96;
      }

      if (venue) {
        ctx.fillStyle = '#a97c2f';
        ctx.font = '700 16px Inter, sans-serif';
        ctx.fillText('V E N U E', W / 2, detailY);

        let venueSize = 22;
        let venueLines = [venue];
        const venueMaxWidth = 780;
        while (venueSize > 16) {
          ctx.font = '700 ' + venueSize + 'px Fraunces, serif';
          venueLines = wrapLines(ctx, venue, venueMaxWidth);
          if (venueLines.length <= 2 && venueLines.every((l) => ctx.measureText(l).width <= venueMaxWidth)) break;
          venueSize -= 1;
        }
        ctx.fillStyle = '#5a3a12';
        ctx.font = '700 ' + venueSize + 'px Fraunces, serif';
        let venueY = detailY + 34;
        venueLines.forEach((line) => {
          ctx.fillText(line, W / 2, venueY);
          venueY += venueSize * 1.2;
        });
      }

      // Footer — soft closing note, with a small reference ID (not styled as a ticket seat)
      ctx.fillStyle = '#a9863f';
      ctx.font = '600 13px Inter, sans-serif';
      ctx.fillText('Pass ID: ' + registration.id + '   \u2022   Please keep this for entry', W / 2, H - 68);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
      if (!blob) throw new Error('toBlob failed');

      const objectUrl = URL.createObjectURL(blob);
      passPreviewImg.src = objectUrl;
      const safeName = eventName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      passBlobData = { blob, filename: safeName + '-pass-' + registration.id + '.png' };

      passBlock.classList.add('show');
      passDownloadBtn.disabled = false;
      passShareBtn.disabled = false;
    } catch (err) {
      passStatus.textContent = 'Could not generate your pass image. You can still take a screenshot of this page.';
    }
  }

  if (passDownloadBtn) {
    passDownloadBtn.addEventListener('click', () => {
      if (!passBlobData) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(passBlobData.blob);
      a.download = passBlobData.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  }

  if (passShareBtn) {
    passShareBtn.addEventListener('click', async () => {
      if (!passBlobData) return;
      const shareText = 'I just registered for ' + ((CONFIG && CONFIG.eventName) || 'this event') + '! Join me \u2014 register here.';
      const file = new File([passBlobData.blob], passBlobData.filename, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: (CONFIG && CONFIG.eventName) || 'Event Pass', text: shareText });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      if (navigator.share) {
        try {
          await navigator.share({ title: (CONFIG && CONFIG.eventName) || 'Event Pass', text: shareText, url: window.location.href });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
        }
      }
      passDownloadBtn.click();
      passStatus.textContent = 'Sharing isn\u2019t supported in this browser \u2014 your pass was downloaded instead.';
    });
  }

  form.addEventListener('submit', handleSubmit);
  loadConfig();
})();
