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

function showAclibAdWithCountdown(options = {}) {
  if (document.getElementById('aclib-ad-overlay')) return;

  const initialSeconds = typeof options.initialSeconds === 'number' ? options.initialSeconds : 15;
  const mainSeconds = typeof options.mainSeconds === 'number' ? options.mainSeconds : 34;
  const adClickUrl = options.adClickUrl || 'https://www.profitableratecpmnetwork.com/ke7tsjm03d?key=a96268fc04237d289e7e7bd64904e2f6';

  let countdown = initialSeconds;
  let phase = 'initial';
  let timer = null;
  let creditIssued = false;
  let completed = false;

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
    border-radius: 12px;
    padding: 18px 18px 56px 18px;
    max-width: 760px;
    width: 94%;
    text-align: center;
    color: #fff;
    box-shadow: 0 20px 60px rgba(102, 126, 234, 0.25);
    font-family: 'Segoe UI', Arial, sans-serif;
    position: relative;
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
    font-size: 44px;
    font-weight: 800;
    color: #4CAF50;
    margin-bottom: 8px;
    line-height: 1;
  `;

  const hint = document.createElement('p');
  hint.id = 'aclib-hint';
  hint.textContent = 'seconds until you can skip';
  hint.style.cssText = `
    color: #bbb;
    font-size: 13px;
    margin-bottom: 10px;
  `;

  let skipAllowed = false;

  const skipBtn = document.createElement('button');
  skipBtn.id = 'aclib-skip-btn';
  skipBtn.textContent = 'Skip';
  skipBtn.type = 'button';
  skipBtn.style.cssText = `
    position: absolute;
    left: 14px;
    bottom: 10px;
    background: #666;
    color: white;
    padding: 10px 14px;
    border: none;
    border-radius: 8px;
    font-weight: 700;
    cursor: not-allowed;
    font-size: 14px;
    z-index: 100001;
  `;

  const goAdFreeBtn = document.createElement('button');
  goAdFreeBtn.id = 'aclib-goadfree-btn';
  goAdFreeBtn.textContent = 'Go ad-free';
  goAdFreeBtn.type = 'button';
  goAdFreeBtn.style.cssText = `
    position: absolute;
    right: 14px;
    bottom: 10px;
    background: #ffb84d;
    color: #111;
    padding: 10px 14px;
    border: none;
    border-radius: 8px;
    font-weight: 700;
    cursor: pointer;
    font-size: 14px;
    z-index: 100002;
  `;

  function finishOverlay() {
    if (completed) return;
    completed = true;
    if (timer) clearInterval(timer);
    try { overlay.remove(); } catch (e) {}
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  function getCurrentUserEmail() {
    const currentUser = (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) ? firebase.auth().currentUser : null;
    return ((currentUser && currentUser.email) || localStorage.getItem('userEmail') || localStorage.getItem('email') || '').trim();
  }

  function openAdLink() {
    const url = adClickUrl || '/ads.html';
    const newWin = window.open(url, '_blank', 'noopener,noreferrer');
    if (newWin) newWin.opener = null;
  }

  async function creditGoAdFree() {
    const userEmail = getCurrentUserEmail();
    if (!userEmail) {
      openAdLink();
      finishOverlay();
      return;
    }

    try {
      const response = await fetch('/api/credit-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok && data && data.error) {
        console.warn('Ad credit failed:', data.error);
      }
    } catch (err) {
      console.warn('Could not credit ad click:', err);
    }

    openAdLink();
    finishOverlay();
  }

  function startCountdownLoop() {
    if (timer) clearInterval(timer);

    timer = setInterval(() => {
      countdown -= 1;
      countdownEl.textContent = String(countdown);

      if (phase === 'initial' && countdown <= 0) {
        phase = 'main';
        countdown = mainSeconds;
        countdownEl.textContent = String(countdown);
        skipAllowed = true;
        skipBtn.style.background = '#667eea';
        skipBtn.style.cursor = 'pointer';
        skipBtn.title = 'Click to skip ad';
        hint.textContent = 'Skip enabled — ad will finish shortly';
        return;
      }

      if (phase === 'main' && countdown <= 0) {
        finishOverlay();
      }
    }, 1000);
  }

  skipBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!skipAllowed) return;
    finishOverlay();
  };

  goAdFreeBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (creditIssued) return;
    creditIssued = true;
    await creditGoAdFree();
    finishOverlay();
  };

  const adContainer = document.createElement('div');
  adContainer.id = 'aclib-ad-container';
  adContainer.style.cssText = `
    width: 100%;
    height: 320px;
    background: #0f1724;
    border-radius: 8px;
    margin: 6px 0 12px 0;
    overflow: hidden;
  `;

  modal.appendChild(title);
  modal.appendChild(message);
  modal.appendChild(adContainer);
  modal.appendChild(countdownEl);
  modal.appendChild(hint);
  overlay.appendChild(modal);
  modal.appendChild(skipBtn);
  modal.appendChild(goAdFreeBtn);
  document.body.appendChild(overlay);

  startCountdownLoop();

  function loadProviderScripts(container) {
    if (!container) return;

    const bannerScript = document.createElement('script');
    bannerScript.type = 'text/javascript';
    bannerScript.textContent = `
      window.atOptions = {
        'key' : '457f65cbe904e42fea908d570f00bbb2',
        'format' : 'iframe',
        'height' : 250,
        'width' : 300,
        'params' : {}
      };
    `;
    container.appendChild(bannerScript);

    const bannerInvoke = document.createElement('script');
    bannerInvoke.type = 'text/javascript';
    bannerInvoke.src = 'https://www.highrevenueformat.com/457f65cbe904e42fea908d570f00bbb2/invoke.js';
    bannerInvoke.async = true;
    container.appendChild(bannerInvoke);

    const naiveBannerScript = document.createElement('script');
    naiveBannerScript.async = true;
    naiveBannerScript.setAttribute('data-cfasync', 'false');
    naiveBannerScript.src = 'https://pl30708907.profitableratecpmnetwork.com/4b1cf630fa653f9661f13acbf3b9bcf9/invoke.js';
    container.appendChild(naiveBannerScript);

    const naiveBannerContainer = document.createElement('div');
    naiveBannerContainer.id = 'container-4b1cf630fa653f9661f13acbf3b9bcf9';
    naiveBannerContainer.style.cssText = 'width:100%;min-height:120px;display:flex;align-items:center;justify-content:center;';
    container.appendChild(naiveBannerContainer);

    const popUnder = document.createElement('script');
    popUnder.src = 'https://pl30708906.profitableratecpmnetwork.com/f2/0a/64/f20a64eb43c44172c8e55cd3d4f83180.js';
    popUnder.async = true;
    container.appendChild(popUnder);

    const socialBar = document.createElement('script');
    socialBar.src = 'https://pl30708908.profitableratecpmnetwork.com/5c/05/aa/5c05aa5758fb38981318f56bed269096.js';
    socialBar.async = true;
    container.appendChild(socialBar);
  }

  loadProviderScripts(adContainer);

  // keep compatibility with other pages that expect the old loader hook, but prefer the HighRevenueFormat snippet
  if (typeof aclib !== 'undefined' && aclib.runAutoTag) {
    try {
      aclib.runAutoTag({ zoneId: 'amqbk88f3h', containerId: 'aclib-ad-container' });
    } catch (err) {
      console.warn('Error triggering aclib ad:', err);
    }
  }
}

window.addEventListener('beforeunload', () => {
  try {
    const overlay = document.getElementById('aclib-ad-overlay');
    if (overlay) {
      overlay.remove();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
  } catch (e) {}
  window.__aclibVendorTriggered = false;
});

window.addEventListener('pagehide', () => {
  try {
    const overlay = document.getElementById('aclib-ad-overlay');
    if (overlay) {
      overlay.remove();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
  } catch (e) {}
  window.__aclibVendorTriggered = false;
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAclibAd);
} else {
  initAclibAd();
}
