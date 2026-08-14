(function () {
  if (window.__watch2earnAutoTagLoaded) return;
  window.__watch2earnAutoTagLoaded = true;

  const SHOW_EVERY_MS = 100000;
  let countdownTimer = null;
  let isVisible = false;

  function getUserEmail() {
    try {
      const user = (window.firebase && firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser : null;
      return user && user.email ? user.email.toLowerCase() : '';
    } catch (e) {
      return '';
    }
  }

  function ensureOverlay() {
    let overlay = document.getElementById('watch2earnAutoTagOverlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'watch2earnAutoTagOverlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.75)';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '999999';
    overlay.style.padding = '20px';
    overlay.innerHTML = `
      <div style="width:min(420px,100%);background:#111827;color:#f3f4f6;border:1px solid #374151;border-radius:18px;padding:22px 18px 16px;box-shadow:0 20px 50px rgba(0,0,0,.45);font-family:Segoe UI, Arial, sans-serif;">
        <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#a5b4fc;font-weight:700;margin-bottom:8px;">Sponsored offer</div>
        <h3 style="margin:0 0 8px;font-size:28px;line-height:1.2;color:#fff;">Quick ad break</h3>
        <p style="margin:0 0 18px;color:#d1d5db;line-height:1.6;font-size:15px;">A sponsor message is available. You can skip it after the countdown or continue to the site.</p>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:12px;background:#0f172a;border:1px solid #1f2937;margin-bottom:18px;">
          <span style="color:#cbd5e1;font-size:14px;">Continue in</span>
          <strong id="watch2earnAutoTagCountdown" style="font-size:28px;color:#34d399;min-width:36px;text-align:right;">5</strong>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
          <button data-action="skip" style="background:transparent;border:1px solid #475569;color:#e2e8f0;border-radius:10px;padding:10px 16px;font-size:14px;font-weight:700;cursor:pointer;">Skip</button>
          <button data-action="continue" style="background:#4CAF50;border:none;color:#fff;border-radius:10px;padding:10px 18px;font-size:14px;font-weight:700;cursor:pointer;">Continue to site</button>
        </div>
      </div>
    `;

    const skipBtn = overlay.querySelector('[data-action="skip"]');
    const continueBtn = overlay.querySelector('[data-action="continue"]');
    const countdownValue = overlay.querySelector('#watch2earnAutoTagCountdown');

    skipBtn.addEventListener('click', () => {
      cleanupOverlay();
      overlay.hidden = true;
      isVisible = false;
    });

    continueBtn.addEventListener('click', () => {
      cleanupOverlay();
      overlay.hidden = true;
      isVisible = false;
    });

    overlay._countdownValue = countdownValue;
    document.body.appendChild(overlay);
    return overlay;
  }

  function cleanupOverlay() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function startCountdown() {
    const overlay = ensureOverlay();
    const countdownValue = overlay._countdownValue;
    let remaining = 5;
    countdownValue.textContent = String(remaining);

    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        cleanupOverlay();
        countdownValue.textContent = '0';
        return;
      }
      countdownValue.textContent = String(remaining);
    }, 1000);
  }

  function showOverlay() {
    const overlay = ensureOverlay();
    if (isVisible) return;
    isVisible = true;
    overlay.hidden = false;
    startCountdown();
    fetch('/api/auto-tag/mark-shown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: getUserEmail() }),
      cache: 'no-store'
    }).catch(() => {});
  }

  async function checkStatus() {
    try {
      const email = getUserEmail();
      const headers = { 'Content-Type': 'application/json' };
      if (email) headers['X-User-Email'] = email;

      const response = await fetch('/api/auto-tag/status', {
        method: 'GET',
        headers,
        cache: 'no-store'
      });
      const data = await response.json();
      if (data && data.show) {
        showOverlay();
      }
    } catch (e) {
      // no-op: silently ignore when the page is not logged in or backend unavailable
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkStatus, 1000);
    setInterval(checkStatus, 30000);
  });
})();
