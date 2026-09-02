// Shared frontend helpers: theme, notifications, accounts helper
(function(){
  const defaultTheme = 'dark';
  const savedTheme = localStorage.getItem('w2e_theme') || defaultTheme;
  const savedNotify = localStorage.getItem('w2e_notify');

  applyTheme(savedTheme);
  setNotificationEnabled(savedNotify !== 'false');

  function applyTheme(t){
    if(t==='dark') document.documentElement.setAttribute('data-theme','dark');
    else document.documentElement.setAttribute('data-theme','light');
    localStorage.setItem('w2e_theme', t || defaultTheme);
  }

  function setNotificationEnabled(enabled){
    localStorage.setItem('w2e_notify', enabled ? 'true' : 'false');
    window.w2e = window.w2e || {};
    window.w2e.notificationsEnabled = enabled;
  }

  window.w2e = window.w2e || {};
  window.w2e.config = {
    apiKey: 'AIzaSyDnfD0bTUGE12YhwZCnCsR8JN3OVft6El0',
    authDomain: 'enable-authentication-1b56c.firebaseapp.com',
    projectId: 'enable-authentication-1b56c',
    storageBucket: 'enable-authentication-1b56c.firebasestorage.app',
    messagingSenderId: '946417281410',
    appId: '1:946417281410:web:7f4e06e3b4b03946d0079b'
  };
  window.w2e.setTheme = applyTheme;
  window.w2e.setNotificationsEnabled = setNotificationEnabled;

  window.w2e.initFirebase = function(){
    if(typeof firebase === 'undefined' || !firebase.apps) return null;
    if(!firebase.apps.length){
      firebase.initializeApp(window.w2e.config);
    }
    return firebase.app();
  };

  // Redirect users with pending promotion to verifild page
  try {
    // Listen for auth changes and check promotion status
    if (typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().onAuthStateChanged(async (user) => {
          if (!user) return;
          try {
            const token = await user.getIdToken();
            const res = await fetch('/api/users/promoted-status', { headers: { Authorization: 'Bearer ' + token } });
            if (!res.ok) return;
            const info = await res.json();
            // If there's a pending promotion and user not yet promoted, redirect to verifild.html
            if (info && info.pending && !info.promoted) {
              if (!location.pathname.endsWith('/verifild.html')) location.href = '/verifild.html';
              return;
            }

            // If user is promoted, inject a centered nav (home earn VERIFIED history account)
            if (info && info.promoted) {
              injectVerifiedNav(info.referralLink);
            }
          } catch (e) { /* ignore */ }
        });

      function injectVerifiedNav(referralLink) {
        if (document.getElementById('w2e-verified-nav')) return; // already injected
        const nav = document.createElement('div');
        nav.id = 'w2e-verified-nav';
        nav.style.position = 'fixed';
        nav.style.top = '10px';
        nav.style.left = '50%';
        nav.style.transform = 'translateX(-50%)';
        nav.style.zIndex = '9999';
        nav.style.background = '#070709';
        nav.style.border = '1px solid #222';
        nav.style.padding = '8px 12px';
        nav.style.borderRadius = '8px';
        nav.style.display = 'flex';
        nav.style.gap = '14px';
        nav.style.alignItems = 'center';
        nav.style.boxShadow = '0 6px 18px rgba(0,0,0,0.35)';
        const links = [
          { txt: 'Home', href: '/home' },
          { txt: 'Earn', href: '/earn.html' },
          { txt: 'VERIFIED', href: '/verifild.html' },
          { txt: 'History', href: '/history.html' },
          { txt: 'Account', href: '/account.html' }
        ];
        links.forEach(l => {
          const a = document.createElement('a');
          a.href = l.href || '#';
          a.innerText = l.txt;
          a.style.color = (l.txt === 'VERIFIED') ? '#fff' : '#bfeccb';
          a.style.background = (l.txt === 'VERIFIED') ? '#4CAF50' : 'transparent';
          a.style.padding = '6px 10px';
          a.style.borderRadius = '6px';
          a.style.textDecoration = 'none';
          a.style.fontWeight = '700';
          nav.appendChild(a);
        });
        if (referralLink) {
          const r = document.createElement('input');
          r.value = referralLink;
          r.readOnly = true;
          r.style.marginLeft = '8px';
          r.style.padding = '6px 8px';
          r.style.borderRadius = '6px';
          r.style.border = '1px solid #233';
          r.style.background = '#0b0c0f';
          r.style.color = '#cfe8d7';
          r.title = 'Your referral link';
          r.addEventListener('click', () => { try { r.select(); document.execCommand('copy'); } catch(e){} });
          nav.appendChild(r);
        }
        document.body.appendChild(nav);
      }
    }
  } catch (e) {}

  window.w2e.getCurrentUser = function(){
    if(typeof firebase === 'undefined' || !firebase.auth) return null;
    return firebase.auth().currentUser || null;
  };

  window.w2e.requireAuth = function(options = {}){
    const redirectTo = options.redirectTo || 'login.html';
    const user = window.w2e.getCurrentUser();
    if(!user){
      if(typeof window !== 'undefined' && !window.__w2e_redirecting){
        window.__w2e_redirecting = true;
        window.location.href = redirectTo;
      }
      return null;
    }
    return user;
  };

  window.w2e.getAuthHeaders = async function(includeJson = false){
    const token = await window.w2e.getAuthToken();
    const headers = {};
    if(token){ headers.Authorization = 'Bearer ' + token; }
    if(includeJson){ headers['Content-Type'] = 'application/json'; }
    return headers;
  };

  // Notification sounds using WebAudio (no binary files required)
  const audioCtx = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
  function beep(freq, duration=200, volume=0.05){
    if(!audioCtx) return;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.value = volume;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); setTimeout(()=>{ o.stop(); }, duration);
  }
  window.w2e.playNotification = function(type){
    if(window.w2e.notificationsEnabled === false) return;
    if(type==='success') beep(880,220,0.06);
    else if(type==='reject') beep(220,300,0.06);
    else if(type==='newad') { beep(1320,120,0.06); beep(1760,120,0.04); }
    else beep(660,120,0.05);
  };

  // Helpers: get firebase token if signed in
  window.w2e.getAuthToken = async function(){
    if(typeof firebase === 'undefined' || !firebase.auth) return null;
    const user = firebase.auth().currentUser;
    if(!user) return null;
    try { return await user.getIdToken(); } catch(e){ return null; }
  };

  // Shared balance refresh helper - updates any present balance elements across pages
  window.w2e.currentBalanceUsd = 0;
  window.w2e.refreshBalance = async function(opts = {}){
    try {
      const token = await window.w2e.getAuthToken();
      if (!token) {
        console.warn('refreshBalance: No auth token');
        return null;
      }
      const res = await fetch('/api/transactions/balance', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
      if (!res.ok) {
        console.warn('refreshBalance: API returned', res.status);
        return null;
      }
      const data = await res.json();
      
      // Parse balance values
      const balUsd = Number(data.balanceUsd || data.balance || data.totalUsd || 0) || 0;
      const balNaira = Math.round(balUsd * (Number(data.rate || 1500) || 1500));
      const adsEarnUsd = Number(data.adsEarnUsd || 0) || 0;
      const gameEarnUsd = Number(data.gameEarnUsd || 0) || 0;
      const surveyEarnUsd = Number(data.surveyEarnUsd || 0) || 0;
      const referralEarnUsd = Number(data.referralEarnUsd || 0) || 0;
      const bonusEarnUsd = Number(data.bonusEarnUsd || 0) || 0;
      const adCount = Number(data.adCount || 0) || 0;
      
      window.w2e.currentBalanceUsd = balUsd;
      console.log('Balance refreshed:', { balUsd, balNaira, adsEarnUsd });

      // Helper to safely update element text
      const setTextIf = (id, txt) => {
        const el = document.getElementById(id);
        if (el) {
          el.innerText = txt;
          el.textContent = txt;
        }
      };

      // Main balance display (multiple ID variants)
      setTextIf('usd', balUsd.toFixed(2));
      setTextIf('usdBal', balUsd.toFixed(2));
      setTextIf('mainBal', balUsd.toFixed(2));
      setTextIf('totalBalance', '₦' + balNaira.toLocaleString());
      
      // Naira variants
      setTextIf('naira', balNaira.toLocaleString());
      setTextIf('nairaTop', balNaira.toLocaleString());
      setTextIf('topBal', '₦' + balNaira.toLocaleString());
      setTextIf('bal', balNaira.toLocaleString());
      setTextIf('mainNaira', balNaira.toLocaleString());

      // Earnings breakdown (by source)
      const adsNaira = Math.round(adsEarnUsd * 1500);
      const gameNaira = Math.round(gameEarnUsd * 1500);
      const surveyNaira = Math.round(surveyEarnUsd * 1500);
      const refNaira = Math.round(referralEarnUsd * 1500);
      
      setTextIf('adsEarned', '₦' + adsNaira.toLocaleString());
      setTextIf('adsEarn', '$' + adsEarnUsd.toFixed(2));
      setTextIf('gamesEarned', '₦' + gameNaira.toLocaleString());
      setTextIf('gameEarn', '$' + gameEarnUsd.toFixed(2));
      setTextIf('surveysEarned', '₦' + surveyNaira.toLocaleString());
      setTextIf('surveyEarn', '$' + surveyEarnUsd.toFixed(2));
      setTextIf('referralEarned', '₦' + refNaira.toLocaleString());
      setTextIf('refEarn', '$' + referralEarnUsd.toFixed(2));
      
      // Ad count
      setTextIf('adsWatched', adCount);
      setTextIf('adCount', adCount);

      return data;
    } catch (e) {
      console.error('refreshBalance error:', e && e.message);
      return null;
    }
  };

  // Auto-refresh balance when auth state changes and when page becomes visible
  try {
    if (typeof firebase !== 'undefined' && firebase.auth) {
      firebase.auth().onAuthStateChanged(async (user) => {
        if (!user) {
          console.log('No user authenticated');
          return;
        }
        console.log('User authenticated:', user.uid);
        // initial refresh
        await window.w2e.refreshBalance();
        // periodic refresh every 5 seconds
        if (window.__w2e_balance_interval) clearInterval(window.__w2e_balance_interval);
        window.__w2e_balance_interval = setInterval(() => window.w2e.refreshBalance(), 5000);
      });

      // Also refresh when page becomes visible (user returns from another tab)
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          console.log('Page became visible, refreshing balance');
          window.w2e.refreshBalance();
        }
      });

      // Ensure balance loads on page load (call immediately if user already auth'd)
      window.addEventListener('DOMContentLoaded', async () => {
        const user = firebase.auth().currentUser;
        if (user) {
          console.log('Page loaded with auth, refreshing balance');
          await window.w2e.refreshBalance();
        }
      });

      // Also call on window load
      window.addEventListener('load', async () => {
        const user = firebase.auth().currentUser;
        if (user) {
          console.log('Window load event, refreshing balance');
          await window.w2e.refreshBalance();
        }
      });
    }
  } catch (e) { 
    console.error('Balance auto-refresh setup failed:', e);
  }

  // Save a bank/crypto account via API
  window.w2e.saveAccount = async function(payload){
    const token = await window.w2e.getAuthToken();
    if(!token) throw new Error('Not signed in');
    const res = await fetch('/api/accounts', { method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+token}, body: JSON.stringify(payload) });
    const j = await res.json(); if(!res.ok) throw new Error(j.error||'Save failed');
    return j;
  };

  // Fetch saved accounts
  window.w2e.listAccounts = async function(){
    const token = await window.w2e.getAuthToken(); if(!token) return [];
    const res = await fetch('/api/accounts', { headers: { 'Authorization': 'Bearer '+token } });
    if(!res.ok) return [];
    return await res.json();
  };

  window.w2e.api = async function(url, options = {}){
    const { requireAuth = true, headers = {}, body, method = 'GET' } = options;
    const token = await window.w2e.getAuthToken();
    if(requireAuth && !token){
      window.w2e.requireAuth({ redirectTo: 'login.html' });
      throw new Error('Authentication required');
    }

    const request = { method, headers: { ...headers } };
    if(token) request.headers.Authorization = 'Bearer ' + token;
    if(body !== undefined && !(body instanceof FormData)){
      request.headers['Content-Type'] = request.headers['Content-Type'] || 'application/json';
      request.body = typeof body === 'string' ? body : JSON.stringify(body);
    }
    if(body !== undefined && body instanceof FormData){ request.body = body; }

    const res = await fetch(url, request);
    const contentType = res.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await res.json() : await res.text();
    if(!res.ok){
      const err = payload && typeof payload === 'object' ? payload.error || 'Request failed' : payload || 'Request failed';
      throw new Error(err);
    }
    return payload;
  };

  window.w2e.syncMongoUser = async function(extra = {}){
    const user = window.w2e.getCurrentUser();
    if (!user) return null;

    const payload = {
      firebaseUid: user.uid,
      email: user.email || extra.email || '',
      username: extra.username || user.displayName || '',
      displayName: extra.displayName || user.displayName || '',
      referredBy: localStorage.getItem('w2e_ref') || extra.referredBy || null
    };

    try {
      const token = await window.w2e.getAuthToken();
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {})
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to sync MongoDB user');
      return data.user || data;
    } catch (e) {
      console.warn('MongoDB user sync failed:', e.message || e);
      return null;
    }
  };

  // Expose small DOM helper
  document.addEventListener('DOMContentLoaded', ()=>{
    document.querySelectorAll('.switch[data-action="theme"]').forEach(s=>{
      s.classList.toggle('on', (localStorage.getItem('w2e_theme') || defaultTheme) !== 'light');
      s.addEventListener('click', ()=>{ const isOn = s.classList.toggle('on'); applyTheme(isOn ? 'dark' : 'light'); });
    });
    document.querySelectorAll('.switch[data-action="notify"]').forEach(s=>{
      const enabled = localStorage.getItem('w2e_notify') !== 'false';
      s.classList.toggle('on', enabled);
      s.addEventListener('click', ()=>{ const isOn = s.classList.toggle('on'); setNotificationEnabled(isOn); });
    });
  });

  // Load auto-tag overlay logic on pages except the main ads page (don't touch ads.html)
  document.addEventListener('DOMContentLoaded', ()=>{
    try {
      const path = (location.pathname || '').split('/').pop();
      if (path !== 'ads.html') {
        const s = document.createElement('script');
        s.src = '/js/auto-tag-overlay.js';
        s.defer = true;
        document.body.appendChild(s);
      }
    } catch (e) {
      // silent
    }
  });

  // Inject a consistent global navigation for public and admin-panel pages
  document.addEventListener('DOMContentLoaded', ()=>{
    try {
      if (document.getElementById('w2e-global-nav')) return;

      const container = document.createElement('div');
      container.id = 'w2e-global-nav';
      container.style.position = 'fixed';
      container.style.top = '0';
      container.style.left = '0';
      container.style.right = '0';
      container.style.zIndex = '9998';
      container.style.display = 'flex';
      container.style.alignItems = 'center';
      container.style.justifyContent = 'space-between';
      container.style.padding = '8px 14px';
      container.style.background = 'linear-gradient(180deg, rgba(7,7,9,0.95), rgba(7,7,9,0.85))';
      container.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
      container.style.backdropFilter = 'saturate(120%) blur(6px)';

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.gap = '10px';
      left.style.alignItems = 'center';

      const brand = document.createElement('a');
      brand.href = '/home.html';
      brand.innerText = 'Watch2Earn';
      brand.style.fontWeight = '800';
      brand.style.color = '#fff';
      brand.style.textDecoration = 'none';
      brand.style.fontSize = '14px';
      left.appendChild(brand);

      const links = document.createElement('div');
      links.style.display = 'flex';
      links.style.gap = '8px';

      const makeLink = (txt, href) => {
        const a = document.createElement('a');
        a.href = href || '#';
        a.innerText = txt;
        a.style.color = '#bfeccb';
        a.style.textDecoration = 'none';
        a.style.fontWeight = '700';
        a.style.padding = '6px 8px';
        a.style.borderRadius = '6px';
        return a;
      };

      // show admin links when in admin-panel
      const path = (location.pathname || '').toLowerCase();
      if (path.includes('/admin-panel/') || path.includes('/admin')) {
        links.appendChild(makeLink('Dashboard','/admin-panel/users.html'));
        links.appendChild(makeLink('Approvals','/admin-panel/approvals.html'));
        links.appendChild(makeLink('Messages','/admin-panel/messages.html'));
        links.appendChild(makeLink('Withdrawals','/admin-panel/withdrawals.html'));
      } else {
        links.appendChild(makeLink('Home','/home.html'));
        links.appendChild(makeLink('Earn','/earn.html'));
        links.appendChild(makeLink('VERIFIED','/verifild.html'));
        links.appendChild(makeLink('History','/history.html'));
        links.appendChild(makeLink('Account','/account.html'));
      }

      left.appendChild(links);

      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.gap = '8px';
      right.style.alignItems = 'center';

      const authBtn = document.createElement('a');
      authBtn.href = '/login.html';
      authBtn.innerText = 'Login';
      authBtn.style.color = '#fff';
      authBtn.style.background = '#4CAF50';
      authBtn.style.padding = '6px 10px';
      authBtn.style.borderRadius = '6px';
      authBtn.style.textDecoration = 'none';
      authBtn.style.fontWeight = '800';

      const adminLink = makeLink('Admin','/admin-panel/users.html');
      adminLink.style.background = 'transparent';
      adminLink.style.color = '#cfe8d7';

      right.appendChild(authBtn);

      // If page is admin, show Admin link on left instead
      if (path.includes('/admin-panel/') || path.includes('/admin')) {
        left.appendChild(adminLink);
      }

      container.appendChild(left);
      container.appendChild(right);
      document.body.style.paddingTop = '54px';
      document.body.prepend(container);

      // Update auth button based on Firebase auth state
      if (typeof firebase !== 'undefined' && firebase.auth) {
        firebase.auth().onAuthStateChanged(user => {
          if (user) {
            authBtn.innerText = 'Logout';
            authBtn.href = '#';
            authBtn.onclick = async (e) => { e.preventDefault(); try{ await firebase.auth().signOut(); window.location.href='/login.html'; }catch(err){ window.location.href='/login.html'; } };
          } else {
            authBtn.innerText = 'Login';
            authBtn.href = '/login.html';
            authBtn.onclick = null;
          }
        });
      }

    } catch (e) {
      // ignore nav injection failures
      console.warn('nav inject failed', e);
    }
  });

})();
