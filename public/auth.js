// ========== FRONTEND ADMIN AUTH - CORRECT CODE ==========
// Put this in admin.html inside <script> tag or as admin-login.js

const ADMIN_EMAIL = "petervic3600@gmail.com";
const ADMIN_PASSWORD = "Humblee3600$."; // Your saved password

const firebaseConfig = {
  apiKey: "AIzaSyDnfD0bTUGE12YhwZCnCsR8JN3OVft6El0",
  authDomain: "enable-authentication-1b56c.firebaseapp.com",
  projectId: "enable-authentication-1b56c",
  storageBucket: "enable-authentication-1b56c.firebasestorage.app",
  messagingSenderId: "946417281410",
  appId: "1:946417281410:web:7f4e06e3b4b03946d0079b"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

function showError(msg){
  const box = document.getElementById('errorBox');
  if(box){
    box.style.display = 'block';
    box.innerText = msg;
  } else {
    alert(msg);
  }
}

function showAdminPanel(email){
  const loginScreen = document.getElementById('loginScreen');
  const adminPanel = document.getElementById('adminPanel');
  if(loginScreen) loginScreen.style.display = 'none';
  if(adminPanel) adminPanel.style.display = 'block';
  
  const emailShow = document.getElementById('adminEmailShow');
  if(emailShow) emailShow.innerText = email;
  
  // Load your dashboard data
  if(typeof loadData === 'function') loadData();
  if(typeof initCharts === 'function') initCharts();
  if(typeof loadAdminData === 'function') loadAdminData();
}

async function loginAdmin(){
  const emailInput = document.getElementById('emailInput');
  const passwordInput = document.getElementById('passwordInput');
  
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';
  
  const errorBox = document.getElementById('errorBox');
  if(errorBox) errorBox.style.display = 'none';

  if(!email || !password){
    showError('Enter email and password');
    return;
  }

  // STEP 1: Check saved credentials (local security)
  if(email.toLowerCase() !== ADMIN_EMAIL.toLowerCase() || password !== ADMIN_PASSWORD){
    showError(`Invalid admin. Use ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    return;
  }

  try{
    // STEP 2: Try Firebase login (secure)
    // IMPORTANT: Create this user in Firebase Console > Authentication > Add User
    // Email: petervic3600@gmail.com Password: Humblee3600$.
    const cred = await firebase.auth().signInWithEmailAndPassword(email, password);
    
    // Save session
    localStorage.setItem('admin_session', JSON.stringify({
      email: cred.user.email,
      uid: cred.user.uid,
      loggedAt: new Date().toISOString()
    }));
    
    showAdminPanel(cred.user.email);
    
  }catch(firebaseError){
    console.log('Firebase login failed, using local fallback:', firebaseError.message);
    
    // STEP 3: Fallback - Local login if Firebase user not created yet
    // This lets you login even before creating user in Firebase Console
    if(firebaseError.code === 'auth/user-not-found' || firebaseError.code === 'auth/invalid-credential'){
      if(confirm('Firebase user not found. Login with local session?\n\nCreate user in Firebase Console > Authentication with:\nEmail: petervic3600@gmail.com\nPassword: Humblee3600$. \n\nClick OK to continue locally.')){
        localStorage.setItem('admin_session', JSON.stringify({
          email: ADMIN_EMAIL,
          uid: 'local-admin',
          loggedAt: new Date().toISOString(),
          local: true
        }));
        showAdminPanel(ADMIN_EMAIL);
        return;
      }
    }
    
    showError(firebaseError.message);
  }
}

function logoutAdmin(){
  firebase.auth().signOut().catch(()=>{});
  localStorage.removeItem('admin_session');
  const loginScreen = document.getElementById('loginScreen');
  const adminPanel = document.getElementById('adminPanel');
  if(adminPanel) adminPanel.style.display = 'none';
  if(loginScreen) loginScreen.style.display = 'flex';
  const passInput = document.getElementById('passwordInput');
  if(passInput) passInput.value = '';
}

// Auto-login if already logged in
window.addEventListener('load', ()=>{
  const session = JSON.parse(localStorage.getItem('admin_session')||'null');
  if(session && session.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()){
    // Check if session is less than 24 hours old
    const loggedAt = new Date(session.loggedAt).getTime();
    const now = Date.now();
    if(now - loggedAt < 24*60*60*1000){
      showAdminPanel(session.email);
    } else {
      localStorage.removeItem('admin_session');
    }
  }

  // Also listen to Firebase auth state
  firebase.auth().onAuthStateChanged(user=>{
    if(user && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()){
      showAdminPanel(user.email);
    }
  });
});

// Allow Enter key to login
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){
    const loginScreen = document.getElementById('loginScreen');
    if(loginScreen && loginScreen.style.display !== 'none'){
      loginAdmin();
    }
  }
});
