// cpagrip-postback.js
// Sends a lightweight beacon to the server with current user info
async function cpagripTrack(targetUrl, meta = {}) {
  try {
    if (!window.firebase || !firebase.auth) {
      // can't get user info, just navigate
      window.location.href = targetUrl;
      return;
    }

    const user = firebase.auth().currentUser;
    const payload = { extUrl: targetUrl, meta: meta };

    if (user) {
      payload.userId = user.uid;
      payload.email = user.email || '';
      try {
        const token = await user.getIdToken();
        // Prefer sendBeacon for navigation reliability
        const body = JSON.stringify(payload);
        const beaconSent = navigator.sendBeacon && navigator.sendBeacon('/cpagrip-postback', new Blob([body], { type: 'application/json' }));
        if (!beaconSent) {
          await fetch('/cpagrip-postback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body
          });
        }
      } catch (e) {
        // fallback: send without auth
        navigator.sendBeacon && navigator.sendBeacon('/cpagrip-postback', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
      }
    } else {
      // no user - still attempt to notify server
      navigator.sendBeacon && navigator.sendBeacon('/cpagrip-postback', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    }
  } catch (e) {
    console.error('cpagripTrack error', e);
  } finally {
    // proceed to the target URL
    window.location.href = targetUrl;
  }
}

// Expose globally
window.cpagripTrack = cpagripTrack;
