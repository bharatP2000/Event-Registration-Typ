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
      const H = 1180;
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
      const stubY = 860; // where the perforation splits the ticket from its tear-off stub

      // Background — deep cinema-curtain gradient instead of parchment
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#3a0f18');
      bgGrad.addColorStop(0.55, '#280a11');
      bgGrad.addColorStop(1, '#16050a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      const glow1 = ctx.createRadialGradient(W / 2, 40, 20, W / 2, 40, 620);
      glow1.addColorStop(0, 'rgba(216, 169, 64, 0.16)');
      glow1.addColorStop(1, 'rgba(216, 169, 64, 0)');
      ctx.fillStyle = glow1;
      ctx.fillRect(0, 0, W, H);

      // Stub tint, so the torn-off section reads visually distinct
      ctx.fillStyle = 'rgba(216, 169, 64, 0.07)';
      roundRectPath(ctx, 44, stubY, W - 88, H - 44 - stubY, 18);
      ctx.fill();

      // Outer frame
      ctx.strokeStyle = '#d8a940';
      ctx.lineWidth = 3;
      roundRectPath(ctx, 30, 30, W - 60, H - 60, 22);
      ctx.stroke();

      // Film-strip sprocket holes running down both edges, the whole
      // height of the ticket — the classic cinema-ticket tell.
      for (let sy = 96; sy <= H - 96; sy += 46) {
        punchHole(ctx, 66, sy, 9);
        punchHole(ctx, W - 66, sy, 9);
      }

      // Header: small logo + "ADMIT ONE" eyebrow
      if (logoImg) {
        const logoW = 88;
        const logoH = logoW * (logoImg.height / logoImg.width);
        ctx.drawImage(logoImg, (W - logoW) / 2, 62, logoW, logoH);
      }
      const eyebrowY = 190;
      ctx.fillStyle = '#d8a940';
      ctx.font = '700 21px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('A D M I T   O N E', W / 2, eyebrowY);

      // Event name (autofit, wraps up to 2 lines) — the "feature" title
      let nameSize = 60;
      let nameLines = [eventName];
      const nameMaxWidth = 800;
      while (nameSize > 32) {
        ctx.font = '800 ' + nameSize + 'px Fraunces, serif';
        nameLines = wrapLines(ctx, eventName, nameMaxWidth);
        if (nameLines.length <= 2 && nameLines.every((l) => ctx.measureText(l).width <= nameMaxWidth)) break;
        nameSize -= 2;
      }
      if (nameLines.length > 2) nameLines = nameLines.slice(0, 2);

      const nameGrad = ctx.createLinearGradient(0, 230, 0, 230 + nameSize * nameLines.length * 1.15);
      nameGrad.addColorStop(0, '#f7dfa0');
      nameGrad.addColorStop(1, '#c99a3e');
      ctx.fillStyle = nameGrad;
      ctx.font = '800 ' + nameSize + 'px Fraunces, serif';
      let nameY = 238 + nameSize * 0.7;
      nameLines.forEach((line) => {
        ctx.fillText(line, W / 2, nameY);
        nameY += nameSize * 1.12;
      });
      const nameBottom = nameY - nameSize * 1.12 + nameSize * 0.35;

      // "Presented by" credit line, like a film's production credit
      let creditBottom = nameBottom;
      if (organiser) {
        const creditY = nameBottom + 40;
        ctx.fillStyle = '#c9a355';
        ctx.font = '600 15px Inter, sans-serif';
        ctx.fillText('P R E S E N T E D   B Y', W / 2, creditY);
        const orgFit = fitSingleLine(ctx, organiser, 760, 24, 16, '600', 'Inter, sans-serif');
        ctx.fillStyle = '#f3e3c5';
        ctx.font = '600 ' + orgFit.size + 'px Inter, sans-serif';
        ctx.fillText(orgFit.text, W / 2, creditY + 32);
        creditBottom = creditY + 32;
      }

      const dividerY = creditBottom + 34;
      drawDashedDivider(ctx, 110, W - 110, dividerY, 'rgba(216,169,64,0.35)');

      // Guest row, centered like a ticket's named admission line
      const guestY = dividerY + 74;
      ctx.fillStyle = '#c9a355';
      ctx.font = '700 17px Inter, sans-serif';
      ctx.fillText('G U E S T', W / 2, guestY);
      const guestFit = fitSingleLine(ctx, registration.name || '\u2014', 840, 42, 26, '700', 'Fraunces, serif');
      ctx.fillStyle = '#fdf6e3';
      ctx.font = '700 ' + guestFit.size + 'px Fraunces, serif';
      ctx.fillText(guestFit.text, W / 2, guestY + 48);

      const grid1DividerY = guestY + 78;
      drawDashedDivider(ctx, 110, W - 110, grid1DividerY, 'rgba(216,169,64,0.28)');

      // 2x2 seat-style detail grid: ZONE / CATEGORY, SHOWTIME / SEAT NO.
      const colX = [110, 110 + 430];
      const colW = 380;
      const showtime = [CONFIG && CONFIG.eventDate, CONFIG && CONFIG.eventTime].filter(Boolean).join(' \u2022 ') || 'TBA';
      const gridRows = [
        [
          ['ZONE', registration.area || '\u2014'],
          ['CATEGORY', registration.memberOf || '\u2014'],
        ],
        [
          ['SHOWTIME', showtime],
          ['SEAT NO.', '#' + registration.id],
        ],
      ];
      let gridY = grid1DividerY + 58;
      gridRows.forEach((rowPair, rIdx) => {
        rowPair.forEach(([label, value], cIdx) => {
          ctx.textAlign = 'left';
          ctx.fillStyle = '#c9a355';
          ctx.font = '700 16px Inter, sans-serif';
          ctx.fillText(label, colX[cIdx], gridY);
          const fit = fitSingleLine(ctx, String(value), colW, 30, 17, '700', 'Fraunces, serif');
          ctx.fillStyle = '#fdf6e3';
          ctx.font = '700 ' + fit.size + 'px Fraunces, serif';
          ctx.fillText(fit.text, colX[cIdx], gridY + 36);
        });
        gridY += 96;
        if (rIdx === 0) drawDashedDivider(ctx, 110, W - 110, gridY - 26, 'rgba(216,169,64,0.2)');
      });

      // Perforation — dashed tear line with a larger notch punched from
      // each edge, like the stub a cinema usher tears off at the door.
      ctx.textAlign = 'center';
      drawDashedDivider(ctx, 96, W - 96, stubY, 'rgba(216,169,64,0.55)');
      punchHole(ctx, 30, stubY, 26);
      punchHole(ctx, W - 30, stubY, 26);

      // Stub — mirrors the seat number and carries the scan barcode
      ctx.textAlign = 'left';
      ctx.fillStyle = '#c9a355';
      ctx.font = '700 16px Inter, sans-serif';
      ctx.fillText('SEAT NO.', 110, stubY + 62);
      ctx.fillStyle = '#f7dfa0';
      ctx.font = '800 46px Fraunces, serif';
      ctx.fillText('#' + registration.id, 110, stubY + 108);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#c9a355';
      ctx.font = '700 16px Inter, sans-serif';
      ctx.fillText('STATUS', W - 110, stubY + 62);
      ctx.fillStyle = '#55c98a';
      ctx.font = '800 30px Fraunces, serif';
      ctx.fillText('CONFIRMED', W - 110, stubY + 100);

      const barcodeY = stubY + 150;
      drawBarcode(ctx, String(registration.id || registration.name || 'pass'), (W - 680) / 2, barcodeY, 680, 46, '#f3e3c5');

      ctx.textAlign = 'center';
      ctx.fillStyle = '#c9a355';
      ctx.font = '600 14px Inter, sans-serif';
      ctx.fillText('SCAN AT ENTRY \u2022 TICKET ' + registration.id, W / 2, barcodeY + 70);

      ctx.fillStyle = '#8a6a3d';
      ctx.font = '600 13px Inter, sans-serif';
      ctx.fillText('Keep this ticket \u2022 Share to invite friends', W / 2, H - 58);

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
