const path = require('path');
const fs = require('fs');
require('dotenv').config();

const keyPath = path.join(__dirname, 'serviceAccountKey.json');

function ensureServiceAccountFile() {
  if (fs.existsSync(keyPath)) return keyPath;

  const raw = process.env.SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '';
  if (process.env.SERVICE_ACCOUNT_JSON) {
    console.log('⚠️ SERVICE_ACCOUNT_JSON found in environment — writing temporary serviceAccountKey.json');
  }
  if (raw) {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, raw);
    return keyPath;
  }

  console.error('❌ serviceAccountKey.json not found at:', keyPath);
  return null;
}

const resolvedKeyPath = ensureServiceAccountFile();
if (!resolvedKeyPath) {
  console.warn('⚠️ serviceAccountKey.json not found — Firebase Admin will be disabled.');
  module.exports = { admin: null, db: null, auth: null, FieldValue: null };
} else {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = resolvedKeyPath;
  console.log('✓ GOOGLE_APPLICATION_CREDENTIALS set to:', resolvedKeyPath);

  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const { getAuth } = require('firebase-admin/auth');
  let app;
  let db;
  let auth;
  try {
    if (getApps().length === 0) {
      console.log('✓ Initializing Firebase Admin with service account credentials...');
      const serviceAccount = JSON.parse(fs.readFileSync(resolvedKeyPath, 'utf8'));
      app = initializeApp({
        credential: cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || 'enable-authentication-1b56c'
      });
      console.log('✓ Firebase Admin initialized');
    } else {
      app = getApps()[0];
      console.log('✓ Firebase app already initialized');
    }
    db = getFirestore(app);
    auth = getAuth(app);
    const admin = { apps: getApps(), auth: () => auth, firestore: { FieldValue } };
    console.log('✅ Firebase Admin SDK fully initialized and ready!\n');
    // If the service account was provided via env var, remove the on-disk copy for safety
    try {
      if (process.env.SERVICE_ACCOUNT_JSON && fs.existsSync(keyPath)) {
        try { fs.unlinkSync(keyPath); console.log('ℹ️ Removed temporary serviceAccountKey.json from disk for safety'); } catch (e) { console.warn('⚠️ Could not remove temporary serviceAccountKey.json:', e && e.message); }
      }
    } catch (e) {}
    module.exports = { admin, db, auth, FieldValue };
  } catch (e) {
    console.error('❌ Firebase initialization failed:', e.message);
    console.error('Stack:', e.stack);
    console.error('\nTroubleshooting:');
    console.error('1. Make sure the Render env var SERVICE_ACCOUNT_JSON is set');
    console.error('2. Download fresh key from Firebase Console → Project Settings → Service Accounts → Generate New Private Key');
    console.error('3. Try: npm install firebase-admin@latest');
    module.exports = { admin: null, db: null, auth: null, FieldValue: null };
  }
}