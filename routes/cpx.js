const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const verifyToken = require('../middleware/auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TXN_PATH = path.join(DATA_DIR, 'transactions.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const CPX_TRACKING_PATH = path.join(DATA_DIR, 'cpx-tracking.json');

// CPX Secure Key from dashboard
const CPX_SECURE_KEY = "CTJ6jPqHw1T80G7qCTxG6AjE72aadXzE";

function ensureFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TXN_PATH)) fs.writeFileSync(TXN_PATH, '[]');
  if (!fs.existsSync(USERS_PATH)) fs.writeFileSync(USERS_PATH, '[]');
  if (!fs.existsSync(CPX_TRACKING_PATH)) fs.writeFileSync(CPX_TRACKING_PATH, '[]');
}

function loadTransactions() {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(TXN_PATH, 'utf8')); } catch (e) { return []; }
}

function saveTransactions(items) {
  ensureFiles();
  fs.writeFileSync(TXN_PATH, JSON.stringify(items, null, 2));
}

function loadUsers() {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); } catch (e) { return []; }
}

function loadCpxTracking() {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(CPX_TRACKING_PATH, 'utf8')); } catch (e) { return []; }
}

function saveCpxTracking(items) {
  ensureFiles();
  fs.writeFileSync(CPX_TRACKING_PATH, JSON.stringify(items, null, 2));
}

// GET /api/cpx/hash - Generate MD5 hash for iframe authentication
router.get('/hash', verifyToken, (req, res) => {
  const userId = req.user.uid || req.user.id;
  const users = loadUsers();
  const user = users.find(u => u.uid === userId || u.id === userId);

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Generate secure hash: MD5(user_id + user_email + CPX_SECURE_KEY)
  const checkString = userId + (user.email || '') + CPX_SECURE_KEY;
  const secureHash = crypto.createHash('md5').update(checkString).digest('hex');

  res.json({
    user_id: userId,
    email: user.email || '',
    username: user.displayName || user.name || 'User',
    secure_hash: secureHash,
    app_id: 35282
  });
});

// GET /api/cpx/postback - CPX calls this when user completes survey
router.get('/postback', async (req, res) => {
  const { status, trans_id, user_id, amount_usd, hash } = req.query;

  console.log('CPX Postback received:', req.query);

  // IMPORTANT: Verify hash to prevent fraud
  const checkString = status + trans_id + user_id + amount_usd + CPX_SECURE_KEY;
  const myHash = crypto.createHash('md5').update(checkString).digest('hex');

  if (myHash !== hash) {
    console.log('Hash mismatch! Expected:', myHash, 'Received:', hash);
    return res.status(403).send('Invalid Hash');
  }

  // Prevent double payment
  const tracking = loadCpxTracking();
  if (tracking.find(t => t.trans_id === trans_id)) {
    console.log('trans_id already processed:', trans_id);
    return res.send('OK - Already Processed');
  }

  // Status 1 = Completed, 2 = Reversed
  if (status === '1') {
    const amountUsd = parseFloat(amount_usd || 0);
    const amountNaira = Math.round(amountUsd * 1500); // 1500 NGN = $1 USD

    const transactions = loadTransactions();
    const newTx = {
      id: trans_id,
      userId: user_id,
      type: 'survey',
      source: 'cpx',
      title: 'CPX Survey Completed',
      amountUsd: amountUsd,
      amountNaira: amountNaira,
      date: new Date().toISOString(),
      cpxTransId: trans_id
    };

    transactions.unshift(newTx);
    saveTransactions(transactions);

    // Track this trans_id
    tracking.push({
      trans_id: trans_id,
      user_id: user_id,
      amount_usd: amountUsd,
      status: 'completed',
      date: new Date().toISOString()
    });
    saveCpxTracking(tracking);

    console.log(`✅ Credited ₦${amountNaira} ($${amountUsd}) to user ${user_id} for survey`);
  } else if (status === '2') {
    // Reversed - remove earnings
    const amountUsd = parseFloat(amount_usd || 0);
    const amountNaira = Math.round(amountUsd * 1500);

    const transactions = loadTransactions();
    const reversal = {
      id: trans_id + '_reversed',
      userId: user_id,
      type: 'survey_reversal',
      source: 'cpx',
      title: 'CPX Survey Reversed',
      amountUsd: -amountUsd,
      amountNaira: -amountNaira,
      date: new Date().toISOString(),
      cpxTransId: trans_id
    };

    transactions.unshift(reversal);
    saveTransactions(transactions);

    // Track reversal
    const tracking = loadCpxTracking();
    const idx = tracking.findIndex(t => t.trans_id === trans_id);
    if (idx !== -1) {
      tracking[idx].status = 'reversed';
      tracking[idx].reversedAt = new Date().toISOString();
    }
    saveCpxTracking(tracking);

    console.log(`⚠️ Reversed ₦${amountNaira} ($${amountUsd}) from user ${user_id}`);
  }

  // MUST return 'OK' or CPX will retry
  res.send('OK');
});

module.exports = router;
