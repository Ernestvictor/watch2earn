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
  window.w2e.setTheme = applyTheme;
  window.w2e.setNotificationsEnabled = setNotificationEnabled;

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

})();
