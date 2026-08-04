const path = require('path');
const fs = require('fs');
require('dotenv').config();
const keyPath = path.join(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(keyPath)) {
  console.error('❌ serviceAccountKey.json not found at:', keyPath);
  process.exit(1);
}
process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;
console.log('✓ GOOGLE_APPLICATION_CREDENTIALS set to:', keyPath);
const { initializeApp, getApps, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
let app;
let db;
let auth;
try {
  if (getApps().length === 0) {
    console.log('✓ Initializing Firebase Admin with service account credentials...');
    const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
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
  module.exports = { admin, db, auth, FieldValue };
} catch (e) {
  console.error('❌ Firebase initialization failed:', e.message);
  console.error('Stack:', e.stack);
  console.error('\nTroubleshooting:');
  console.error('1. Make sure config/serviceAccountKey.json exists');
  console.error('2. Download fresh key from: Firebase Console → Project Settings → Service Accounts → Generate New Private Key');
  console.error('3. Try: npm install firebase-admin@latest');
  process.exit(1);
}