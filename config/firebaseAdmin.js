const fs = require('fs');
require('dotenv').config();

function getServiceAccountFromEnvironment() {
  // Check multiple environment variable names for Firebase service account JSON
  const raw = process.env.SERVICE_ACCOUNT_JSON || 
              process.env.FIREBASE_SERVICE_ACCOUNT_JSON || 
              process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || '';
  
  if (!raw) {
    console.error('❌ No Firebase service account found in environment variables');
    console.error('   Set one of: SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_JSON, or GOOGLE_APPLICATION_CREDENTIALS_JSON');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(raw);
    console.log('✓ Firebase service account loaded directly from environment variable');
    return serviceAccount;
  } catch (parseErr) {
    console.error('❌ Failed to parse service account JSON from environment:', parseErr.message);
    return null;
  }
}

const serviceAccount = getServiceAccountFromEnvironment();

if (!serviceAccount) {
  console.warn('⚠️ Firebase service account not available — Firebase Admin will be disabled.');
  module.exports = { admin: null, db: null, auth: null, FieldValue: null };
} else {
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const { getAuth } = require('firebase-admin/auth');
  let app;
  let db;
  let auth;
  try {
    if (getApps().length === 0) {
      console.log('✓ Initializing Firebase Admin with service account credentials from environment...');
      app = initializeApp({
        credential: cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id || 'enable-authentication-1b56c'
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
    console.error('1. Make sure the Render env var SERVICE_ACCOUNT_JSON is set with a valid JSON string');
    console.error('2. Download fresh key from Firebase Console → Project Settings → Service Accounts → Generate New Private Key');
    console.error('3. Ensure the JSON is properly formatted (no syntax errors)');
    console.error('4. Try: npm install firebase-admin@latest');
    module.exports = { admin: null, db: null, auth: null, FieldValue: null };
  }
}