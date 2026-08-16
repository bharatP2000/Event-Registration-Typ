(function () {
  const form = document.getElementById('reg-form');
  const payBtn = document.getElementById('pay-btn');
  const nameInput = document.getElementById('name');
  const mobileInput = document.getElementById('mobile');
  // const emailInput = document.getElementById('email');
  const areaSelect = document.getElementById('area');
  const memberOfSelect = document.getElementById('memberOf');
  const amountDisplay = document.getElementById('amount-display');
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
  const confirmRef = document.getElementById('confirm-ref');
  // const confirmEmailNote = document.getElementById('confirm-email-note');

  // const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  function clearFieldErrors() {
    ['name', 'mobile', 'area', 'memberOf'].forEach((id) => fieldError(id, ''));
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
    // const email = emailInput.value.trim();
    const area = areaSelect.value;
    const memberOf = memberOfSelect.value;

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

    return ok ? { name, mobile, area, memberOf } : null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    clearBanner();

    const data = validate();
    if (!data) return;

    payBtn.disabled = true;
    payBtn.textContent = 'Starting payment\u2026';

    try {
      // Step 1: form data + Razorpay order are created together (atomic) --
      // there is no separate "saved, pay later" state.
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const order = await res.json();

      if (!res.ok) {
        showBanner(order.error || 'Something went wrong. Please try again.', 'error');
        payBtn.disabled = false;
        payBtn.textContent = 'Register & Pay';
        return;
      }

      // Step 2: open Razorpay checkout immediately with that order.
      const rzp = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: order.eventName,
        description: 'Event registration fee',
        prefill: {
          name: data.name,
          contact: data.mobile,
        },
        theme: { color: '#8a1c2e' },
        handler: async function (response) {
          await verifyPayment(response, data);
        },
        modal: {
          ondismiss: function () {
            payBtn.disabled = false;
            payBtn.textContent = 'Register & Pay';
            showBanner('Payment was not completed. You can try again.', 'error');
          },
        },
      });

      rzp.on('payment.failed', function () {
        payBtn.disabled = false;
        payBtn.textContent = 'Register & Pay';
        showBanner('Payment failed. Please try again.', 'error');
      });

      rzp.open();
    } catch (err) {
      showBanner('Network error. Please check your connection and try again.', 'error');
      payBtn.disabled = false;
      payBtn.textContent = 'Register & Pay';
    }
  }

  async function verifyPayment(response, data) {
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        }),
      });
      const result = await res.json();

      if (!res.ok || !result.success) {
        showBanner(result.error || 'Payment could not be verified. Please contact support.', 'error');
        payBtn.disabled = false;
        payBtn.textContent = 'Register & Pay';
        return;
      }

      form.style.display = 'none';
      confirmation.classList.add('show');
      confirmId.textContent = '#' + result.registration.id;
      confirmName.textContent = data.name;
      confirmArea.textContent = data.area;
      confirmMemberOf.textContent = data.memberOf;
      // confirmEmailNote.textContent = 'A confirmation has been sent to ' + data.email + '.';
      confirmRef.textContent = 'Payment ID: ' + response.razorpay_payment_id;
    } catch (err) {
      showBanner('Payment succeeded but verification failed. Please contact support with your payment ID.', 'error');
    }
  }

  form.addEventListener('submit', handleSubmit);
  loadConfig();
})();
