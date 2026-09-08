/**
 * aclib-ad-wrapper.js
 * Integrates aclib ads without the 100-second interval gate
 */

let aclibAdState = {
  userEmail: null,
  initialized: false,
  blockedPaths: [
    '/index.html',
    '/login.html',
    '/logout.html',
    '/admin-panel',
    '/admin-panel/',
    '/admin-panel/verify.html',
    '/admin-panel/carbinate.html'
  ]
};

if (!window.__aclibWrapperStarted) {
  window.__aclibWrapperStarted = true;
}

function shouldBlockAclib() {
  const path = (window.location.pathname || '').toLowerCase();
  return aclibAdState.blockedPaths.some(blocked => path === blocked || path.endsWith(blocked));
}

function vendorAutoTagAlreadyExists() {
  return Array.from(document.scripts).some(script => {
    const text = (script.textContent || '').replace(/\s+/g, ' ');
    return text.includes("zoneId: 'amqbk88f3h'") || text.includes('zoneId:"amqbk88f3h"') ||
      (script.src || '').includes('acscdn.com/script/aclib.js');
  });
}

async function initAclibAd() {
  if (aclibAdState.initialized || shouldBlockAclib()) return;
  aclibAdState.initialized = true;

  try {
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      aclibAdState.userEmail = firebase.auth().currentUser.email;
    }

    if (!aclibAdState.userEmail) {
      aclibAdState.userEmail = localStorage.getItem('userEmail');
    }

    if (aclibAdState.userEmail) {
      checkAndShowAclibAd();
    }
  } catch (err) {
    console.warn('Error initializing aclib ad:', err);
  }
}

async function checkAndShowAclibAd() {
  if (shouldBlockAclib() || document.getElementById('aclib-ad-overlay')) return;

  try {
    if (!aclibAdState.userEmail) return;

    const response = await fetch(`/api/ad-check?email=${encodeURIComponent(aclibAdState.userEmail)}`);
    const data = await response.json();

    if (data.shouldShow) {
      showAclibAdWithCountdown();
    }
  } catch (err) {
    console.warn('Error checking aclib ad:', err);
  }
}

function showAclibAdWithCountdown() {
  if (document.getElementById('aclib-ad-overlay')) return;

  let countdown = 5;
  const overlay = document.createElement('div');
  overlay.id = 'aclib-ad-overlay';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 99999;
  `;

  const modal = document.createElement('div');
  modal.style.cssText = `
    background: linear-gradient(135deg, #1a1a2e, #16213e);
    border: 2px solid #667eea;
    border-radius: 20px;
    padding: 40px 30px;
    max-width: 360px;
    text-align: center;
    color: #fff;
    box-shadow: 0 20px 60px rgba(102, 126, 234, 0.3);
    font-family: 'Segoe UI', Arial, sans-serif;
  `;

  const title = document.createElement('h2');
  title.textContent = '📺 Special Offer';
  title.style.cssText = `
    font-size: 26px;
    margin-bottom: 15px;
    color: #667eea;
    font-weight: bold;
    letter-spacing: 0.5px;
  `;

  const message = document.createElement('p');
  message.textContent = 'Watch an exclusive ad to earn rewards';
  message.style.cssText = `
    font-size: 16px;
    color: #e0e0e0;
    line-height: 1.5;
    margin-bottom: 25px;
  `;

  const countdownEl = document.createElement('div');
  countdownEl.id = 'aclib-countdown';
  countdownEl.textContent = String(countdown);
  countdownEl.style.cssText = `
    font-size: 54px;
    font-weight: 800;
    color: #4CAF50;
    margin-bottom: 18px;
    line-height: 1;
  `;

  const hint = document.createElement('p');
  hint.textContent = 'seconds until you can skip';
  hint.style.cssText = `
    color: #bbb;
    font-size: 13px;
    margin-bottom: 18px;
  `;

  const skipBtn = document.createElement('button');
  skipBtn.textContent = 'Skip';
  skipBtn.disabled = true;
  skipBtn.style.cssText = `
    background: #666;
    color: white;
    padding: 12px 18px;
    border: none;
    border-radius: 10px;
    font-weight: 700;
    cursor: not-allowed;
    width: 100%;
    font-size: 15px;
  `;

  const timer = setInterval(() => {
    countdown -= 1;
    countdownEl.textContent = String(countdown);

    if (countdown <= 0) {
      clearInterval(timer);
      skipBtn.disabled = false;
      skipBtn.style.background = '#667eea';
      skipBtn.style.cursor = 'pointer';
      hint.textContent = 'You can now skip';
    }
  }, 1000);

  skipBtn.onclick = () => {
    clearInterval(timer);
    overlay.remove();
  };

  modal.appendChild(title);
  modal.appendChild(message);
  modal.appendChild(countdownEl);
  modal.appendChild(hint);
  modal.appendChild(skipBtn);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  if (typeof aclib !== 'undefined' && aclib.runAutoTag) {
    try {
      aclib.runAutoTag({ zoneId: 'amqbk88f3h' });
    } catch (err) {
      console.warn('Error triggering aclib ad:', err);
    }
  }
}

window.addEventListener('beforeunload', () => {
  const overlay = document.getElementById('aclib-ad-overlay');
  if (overlay) overlay.remove();
  window.__aclibVendorTriggered = false;
});

window.addEventListener('pagehide', () => {
  const overlay = document.getElementById('aclib-ad-overlay');
  if (overlay) overlay.remove();
  window.__aclibVendorTriggered = false;
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAclibAd);
} else {
  initAclibAd();
}
