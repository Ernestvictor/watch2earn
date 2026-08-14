/**
 * aclib-modal.js - Display an ad with 5-second countdown
 * Calls /api/ad-check to determine if ad should show (100s interval per user)
 * Shows a modal with countdown, then allows user to skip or continue
 */

let aclibAdShown = false;
let aclibCheckInterval = null;

async function checkAndShowAclibAd() {
  try {
    // Get current user email from Firebase or session
    let userEmail = null;
    
    // Try Firebase
    if (typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser) {
      userEmail = firebase.auth().currentUser.email;
    }
    
    // Try localStorage fallback
    if (!userEmail) {
      userEmail = localStorage.getItem('userEmail');
    }
    
    if (!userEmail) {
      return; // No email, can't check
    }

    // Check if ad should show
    const response = await fetch(`/api/ad-check?email=${encodeURIComponent(userEmail)}`);
    const data = await response.json();

    if (data.shouldShow && !aclibAdShown) {
      showAclibCountdownModal(data.sessionId);
    }
  } catch (err) {
    console.warn('Error checking aclib ad:', err);
  }
}

function showAclibCountdownModal(sessionId) {
  aclibAdShown = true;
  let countdown = 5;

  // Create modal HTML
  const modal = document.createElement('div');
  modal.id = 'aclib-modal-overlay';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  `;

  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background: #1a1a1d;
    border: 1px solid #667eea;
    border-radius: 16px;
    padding: 30px 24px;
    max-width: 320px;
    text-align: center;
    color: #fff;
    box-shadow: 0 10px 40px rgba(102, 126, 234, 0.2);
  `;

  const title = document.createElement('h2');
  title.textContent = '📺 Special Offer';
  title.style.cssText = `
    font-size: 20px;
    margin-bottom: 12px;
    color: #667eea;
    font-weight: bold;
  `;

  const message = document.createElement('p');
  message.textContent = 'Watch an exclusive ad offer to continue';
  message.style.cssText = `
    font-size: 14px;
    color: #ccc;
    margin-bottom: 20px;
    line-height: 1.4;
  `;

  const countdownDiv = document.createElement('div');
  countdownDiv.id = 'aclib-countdown';
  countdownDiv.style.cssText = `
    font-size: 48px;
    font-weight: bold;
    color: #4CAF50;
    margin: 20px 0;
    line-height: 1;
  `;
  countdownDiv.textContent = countdown;

  const countdownLabel = document.createElement('p');
  countdownLabel.textContent = 'seconds until you can skip';
  countdownLabel.style.cssText = `
    font-size: 12px;
    color: #999;
    margin-bottom: 20px;
  `;

  const skipBtn = document.createElement('button');
  skipBtn.id = 'aclib-skip-btn';
  skipBtn.textContent = 'Skip';
  skipBtn.disabled = true;
  skipBtn.style.cssText = `
    width: 100%;
    padding: 12px;
    background: #666;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-weight: bold;
    cursor: not-allowed;
    font-size: 14px;
    margin-top: 12px;
    transition: all 0.3s;
  `;

  // Countdown timer
  const countdownInterval = setInterval(() => {
    countdown--;
    document.getElementById('aclib-countdown').textContent = countdown;

    if (countdown <= 0) {
      clearInterval(countdownInterval);
      skipBtn.disabled = false;
      skipBtn.style.background = '#667eea';
      skipBtn.style.cursor = 'pointer';
      countdownLabel.textContent = 'You can now skip';
    }
  }, 1000);

  skipBtn.onclick = () => {
    clearInterval(countdownInterval);
    modal.remove();
    aclibAdShown = false; // Reset so next check can show ad again after interval
  };

  modalContent.appendChild(title);
  modalContent.appendChild(message);
  modalContent.appendChild(countdownDiv);
  modalContent.appendChild(countdownLabel);
  modalContent.appendChild(skipBtn);
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // Trigger aclib ad in the background (it will display via aclib)
  if (typeof aclib !== 'undefined' && aclib.runAutoTag) {
    try {
      aclib.runAutoTag({
        zoneId: 'amqbk88f3h',
      });
    } catch (e) {
      console.warn('Error running aclib ad:', e);
    }
  }
}

// Initialize ad checks when page loads
function initAclibAdChecker() {
  // Check immediately on page load
  checkAndShowAclibAd();

  // Check periodically (every 10 seconds)
  aclibCheckInterval = setInterval(checkAndShowAclibAd, 10000);
}

// Start checking when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAclibAdChecker);
} else {
  initAclibAdChecker();
}
