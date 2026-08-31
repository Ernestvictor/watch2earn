const fs = require('fs');
require('dotenv').config();

function parseServiceAccount(rawValue) {
  if (!rawValue) return null;

  try {
    const trimmed = String(rawValue).trim();

    // 1) raw JSON string
    if (trimmed.startsWith('{')) {
      return JSON.parse(trimmed);
    }

    // 2) path to a local JSON file
    if (trimmed.startsWith('./') || trimmed.startsWith('/') || trimmed.includes('\\')) {
      if (fs.existsSync(trimmed)) {
        const fileContent = fs.readFileSync(trimmed, 'utf8');
        return JSON.parse(fileContent);
      }
    }

    // 3) fallback for env values like base64 or escaped JSON string from Render
    const maybeJson = trimmed.replace(/^['\"]|['\"]$/g, '');
    if (maybeJson.startsWith('{')) {
      return JSON.parse(maybeJson);
    }

    return null;
  } catch (err) {
    console.error('❌ Failed to parse service account value:', err.message);
    return null;
  }
}

function getServiceAccountFromEnvironment() {
  const envCandidates = [
    'SERVICE_ACCOUNT_KEY',
    'SERVICE_ACCOUNT_JSON',
    'FIREBASE_SERVICE_ACCOUNT_KEY',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'GOOGLE_APPLICATION_CREDENTIALS_JSON',
    'GOOGLE_SERVICE_ACCOUNT_KEY'
  ];

  for (const key of envCandidates) {
    const raw = process.env[key];
    if (!raw) continue;

    const serviceAccount = parseServiceAccount(raw);
    if (serviceAccount) {
      console.log(`✓ Firebase service account loaded from env: ${key}`);
      return serviceAccount;
    }
  }

  const filePathCandidates = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.FIREBASE_APPLICATION_CREDENTIALS,
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    process.env.SERVICE_ACCOUNT_PATH
  ];

  for (const filePath of filePathCandidates) {
    if (!filePath) continue;
    try {
      if (fs.existsSync(filePath)) {
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(fileContent);
        console.log('✓ Firebase service account loaded from file path');
        return parsed;
      }
    } catch (err) {
      console.warn(`⚠️ Could not read service account file: ${filePath}`);
    }
  }

  console.error('❌ No Firebase service account found in environment variables');
  console.error('   Set one of: SERVICE_ACCOUNT_KEY, SERVICE_ACCOUNT_JSON, FIREBASE_SERVICE_ACCOUNT_KEY, FIREBASE_SERVICE_ACCOUNT_JSON, or GOOGLE_APPLICATION_CREDENTIALS_JSON');
  return null;
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
    console.error('1. Make sure the Render env var SERVICE_ACCOUNT_KEY or SERVICE_ACCOUNT_JSON is set with a valid JSON string');
    console.error('2. Download fresh key from Firebase Console → Project Settings → Service Accounts → Generate New Private Key');
    console.error('3. Ensure the JSON is properly formatted (no syntax errors)');
    console.error('4. Try: npm install firebase-admin@latest');
    module.exports = { admin: null, db: null, auth: null, FieldValue: null };
  }
}