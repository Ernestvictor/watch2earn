/**
 * aclib-ad-wrapper.js
 * Integrates aclib ads with 100-second interval logic and 5-second countdown
 */

let aclibAdState = {
  lastCheck: 0,
  CHECK_INTERVAL: 15000, // Check every 15 seconds
  userEmail: null,
  adShownCount: 0,
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
      // Check periodically
      setInterval(checkAndShowAclibAd, aclibAdState.CHECK_INTERVAL);
    }
  } catch (err) {
    console.warn('Error initializing aclib ad:', err);
  }
}

async function checkAndShowAclibAd() {
  if (shouldBlockAclib() || document.getElementById('aclib-ad-overlay')) return;

  try {
    const now = Date.now();
    if (now - aclibAdState.lastCheck < aclibAdState.CHECK_INTERVAL / 2) {
      return; // Skip if checked recently
    }

    aclibAdState.lastCheck = now;

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
    font-size: 15px;
    color: #ccc;
    margin-bottom: 25px;
    line-height: 1.5;
  `;

  const countdownDiv = document.createElement('div');
  countdownDiv.style.cssText = `
    font-size: 72px;
    font-weight: bold;
    color: #4CAF50;
    margin: 25px 0;
    line-height: 1;
    text-shadow: 0 2px 10px rgba(76, 175, 80, 0.3);
  `;
  countdownDiv.textContent = countdown;

  const countdownLabel = document.createElement('p');
  countdownLabel.textContent = 'seconds until you can skip';
  countdownLabel.style.cssText = `
    font-size: 13px;
    color: #999;
    margin-bottom: 25px;
  `;

  const skipBtn = document.createElement('button');
  skipBtn.textContent = 'Skip';
  skipBtn.disabled = true;
  skipBtn.style.cssText = `
    width: 100%;
    padding: 14px;
    background: #555;
    color: #fff;
    border: none;
    border-radius: 10px;
    font-weight: bold;
    cursor: not-allowed;
    font-size: 15px;
    transition: all 0.3s ease;
  `;

  let countdownInterval = setInterval(() => {
    countdown--;
    countdownDiv.textContent = countdown;

    if (countdown <= 0) {
      clearInterval(countdownInterval);
      skipBtn.disabled = false;
      skipBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
      skipBtn.style.cursor = 'pointer';
      countdownLabel.textContent = 'You can now skip';
    }
  }, 1000);

  skipBtn.onclick = () => {
    clearInterval(countdownInterval);
    window.__aclibVendorTriggered = false;
    overlay.remove();
    aclibAdState.adShownCount++;
  };

  modal.appendChild(title);
  modal.appendChild(message);
  modal.appendChild(countdownDiv);
  modal.appendChild(countdownLabel);
  modal.appendChild(skipBtn);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const alreadyTriggered = vendorAutoTagAlreadyExists() || window.__aclibVendorTriggered;
  if (typeof aclib !== 'undefined' && aclib.runAutoTag && !alreadyTriggered) {
    window.__aclibVendorTriggered = true;
    try {
      aclib.runAutoTag({ zoneId: 'amqbk88f3h' });
    } catch (e) {
      console.warn('Error running aclib:', e);
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
