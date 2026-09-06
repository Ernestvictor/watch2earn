// routes/cpx.js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const verifyToken = require('../middleware/auth');
const mongoNative = require('../mongodb');
const User = require('../models/users');
const { payReferralCommission, createRewardLog } = require('../lib/referralHelpers');

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const TXN_PATH = path.join(DATA_DIR, 'transactions.json');
const CPX_TRACKING_PATH = path.join(DATA_DIR, 'cpx-tracking.json');

// CPX Secure Key from dashboard
const CPX_SECURE_KEY = process.env.CPX_SECURE_KEY || process.env.CPX_SECURE_HASH || "CTJ6jPqHw1T80G7qCTxG6AjE72aadXzE";
const CPX_APP_ID = process.env.CPX_APP_ID || 'watch2earn';

const CPX_API_KEY = process.env.CPX_API_KEY || '35a90c6582f6ff21f81de4d48211c9ea';
const CPX_BASE_URL = 'https://publisher.cpx-research.com/index.php';

function buildCpxApiUrl(page, params = {}) {
  const query = new URLSearchParams({
    api_key: params.api_key || CPX_API_KEY,
    ...params
  });

  query.set('page', page);
  return `${CPX_BASE_URL}?${query.toString()}`;
}

function getDefaultCpxParams(req) {
  return {
    start_time: req.query.start_time || '2026-09-05',
    end_time: req.query.end_time || '2026-12-31',
    app_id: req.query.app_id || 'watch2earn',
    country_code: req.query.country_code || 'ngn',
    group_by: req.query.group_by || 'day'
  };
}

async function loadUsers() {
  try {
    if (mongoNative && typeof mongoNative.getUsersCollection === 'function') {
      const col = mongoNative.getUsersCollection();
      return await col.find({}).toArray();
    }
  } catch (e) { console.warn('loadUsers (cpx) failed:', e && e.message); }
  throw new Error('MongoDB required for CPX routes');
}

async function loadTransactions() {
  try {
    if (mongoNative && typeof mongoNative.getTransactionsCollection === 'function') {
      const col = mongoNative.getTransactionsCollection();
      return await col.find({}).sort({ date: -1 }).limit(10000).toArray();
    }
  } catch (e) { console.warn('loadTransactions (cpx) failed:', e && e.message); }
  throw new Error('MongoDB required for CPX routes');
}

async function saveTransactions(items) {
  try {
    if (mongoNative && typeof mongoNative.getTransactionsCollection === 'function') {
      // insert new transactions if needed - no-op: app code should insert via insertOne
      return;
    }
  } catch (e) { console.warn('saveTransactions (cpx) failed:', e && e.message); }
  throw new Error('MongoDB required for CPX routes');
}

async function loadCpxTracking() {
  try {
    if (mongoNative && typeof mongoNative.getCollection === 'function') {
      const col = mongoNative.getCollection('cpx_tracking');
      return await col.find({}).toArray();
    }
  } catch (e) { console.warn('loadCpxTracking failed:', e && e.message); }
  throw new Error('MongoDB required for CPX routes');
}

async function saveCpxTracking(items) {
  try {
    if (mongoNative && typeof mongoNative.getCollection === 'function') {
      const col = mongoNative.getCollection('cpx_tracking');
      // For simplicity, insert tracking entries
      for (const t of items || []) {
        try { await col.updateOne({ trans_id: t.trans_id }, { $set: t }, { upsert: true }); } catch (e) {}
      }
      return;
    }
  } catch (e) { console.warn('saveCpxTracking failed:', e && e.message); }
  throw new Error('MongoDB required for CPX routes');
}

// GET /api/cpx/hash - Generate MD5 hash for iframe authentication
router.get('/hash', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    // load user from MongoDB
    let user = null;
    try { user = await User.findOne({ $or: [{ firebaseUid: userId }, { uid: userId }, { id: userId }] }).lean(); } catch (e) { /* ignore */ }

    // If user not present in DB, create a lightweight record
    if (!user) {
      const tokenUser = req.user || {};
      const newUser = {
        firebaseUid: userId,
        uid: userId,
        email: tokenUser.email || '',
        displayName: tokenUser.name || tokenUser.displayName || 'User'
      };
      try {
        const created = await User.create(newUser);
        user = created.toObject ? created.toObject() : created;
      } catch (e) {
        console.error('Failed to create user record for CPX hash:', e && e.message);
        return res.status(500).json({ error: 'Failed to create user record' });
      }
    }


    // Generate secure hash: MD5(user_id + user_email + CPX_SECURE_KEY)
    const checkString = userId + (user.email || '') + CPX_SECURE_KEY;
    const secureHash = crypto.createHash('md5').update(checkString).digest('hex');

    res.json({
      user_id: userId,
      email: user.email || '',
      username: user.displayName || user.name || 'User',
      secure_hash: secureHash,
      app_id: CPX_APP_ID
    });
  } catch (err) {
    console.error('Error generating CPX hash:', err);
    res.status(500).json({ error: 'Failed to generate CPX hash' });
  }
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
  let tracking = [];
  try { tracking = await loadCpxTracking(); } catch (e) { return res.status(503).send('MongoDB required'); }
  if ((tracking || []).find(t => t.trans_id === trans_id)) {
    console.log('trans_id already processed:', trans_id);
    return res.send('OK - Already Processed');
  }

  // Status 1 = Completed, 2 = Reversed
  if (status === '1') {
    const amountUsd = parseFloat(amount_usd || 0);
    const amountNaira = Math.round(amountUsd * 1500); // 1500 NGN = $1 USD

    let transactions = [];
    try { transactions = await loadTransactions(); } catch (e) { return res.status(503).send('MongoDB required'); }
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

    // Insert transaction into Mongo
    try {
      const txCol = mongoNative.getTransactionsCollection();
      await txCol.insertOne(newTx);
    } catch (e) { console.error('Failed to insert tx into mongo:', e && e.message); }

    // Track this trans_id
    try {
      const col = mongoNative.getCollection('cpx_tracking');
      await col.updateOne({ trans_id }, { $set: { trans_id, user_id, amount_usd: amountUsd, status: 'completed', date: new Date() } }, { upsert: true });
    } catch (e) { console.error('Failed to save cpx tracking:', e && e.message); }

    // Attempt to credit the user's live wallet immediately and create canonical earning records
    try {
      const updated = await (async () => {
        try {
          const u = await User.findOne({ $or: [{ firebaseUid: user_id }, { uid: user_id }, { id: user_id }, { email: user_id }] });
          if (!u) return null;
          u.wallet = Number(u.wallet || 0) + amountNaira;
          u.totalEarned = Number(u.totalEarned || 0) + amountNaira;
          await u.save();

          // create earning/history/message
          await createRewardLog({ user: u, firebaseUid: u.firebaseUid, type: 'survey', sourceId: `cpx-${trans_id}`, amount: amountNaira, description: 'CPX survey completed', metadata: { cpxTransId: trans_id } });

          // pay referral commission
          try { await payReferralCommission(u, amountNaira, 'survey'); } catch (e) { console.warn('Referral commission (cpx survey) failed:', e && e.message); }

          return u;
        } catch (e) { console.warn('CPX credit user failed:', e && e.message); return null; }
      })();
    } catch (e) { console.warn('CPX credit flow error:', e && e.message); }

    console.log(`✅ Credited ₦${amountNaira} ($${amountUsd}) to user ${user_id} for survey`);
  } else if (status === '2') {
    // Reversed - remove earnings
    const amountUsd = parseFloat(amount_usd || 0);
    const amountNaira = Math.round(amountUsd * 1500);

    let transactions = [];
    try { transactions = await loadTransactions(); } catch (e) { return res.status(503).send('MongoDB required'); }
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

    try {
      const txCol = mongoNative.getTransactionsCollection();
      await txCol.insertOne(reversal);
    } catch (e) { console.error('Failed to insert reversal tx:', e && e.message); }

    try {
      const col = mongoNative.getCollection('cpx_tracking');
      await col.updateOne({ trans_id }, { $set: { status: 'reversed', reversedAt: new Date() } });
    } catch (e) { console.error('Failed to update cpx tracking reversal:', e && e.message); }

    console.log(`⚠️ Reversed ₦${amountNaira} ($${amountUsd}) from user ${user_id}`);
  }

  // MUST return 'OK' or CPX will retry
  res.send('OK');
});

// GET /api/cpx/analytics - return all CPX API URLs for the admin dashboard
router.get('/analytics', (req, res) => {
  const defaultParams = getDefaultCpxParams(req);
  const endpoints = [
    {
      id: 'time',
      label: 'Statistics Time',
      description: 'Returns time-based statistics for the selected range.',
      url: buildCpxApiUrl('api-statistics-time', {
        ...defaultParams,
        api_key: CPX_API_KEY
      })
    },
    {
      id: 'country-sales',
      label: 'Sales by Country',
      description: 'Returns sales statistics grouped by country for the selected time range.',
      url: buildCpxApiUrl('api-statistics-country-sales', {
        start_time: defaultParams.start_time,
        end_time: defaultParams.end_time,
        app_id: defaultParams.app_id,
        country_code: req.query.country_code || 'US',
        api_key: CPX_API_KEY
      })
    },
    {
      id: 'completes',
      label: 'Get Completes',
      description: 'Download a list of completes for the selected date range.',
      url: buildCpxApiUrl('api-statistics-completes', {
        start_time: req.query.completes_start_time || '2020-06-01',
        end_time: req.query.completes_end_time || '2020-06-01',
        api_key: CPX_API_KEY
      })
    },
    {
      id: 'screen-outs',
      label: 'Get Screen Outs',
      description: 'Download a list of screen outs for the selected date range.',
      url: buildCpxApiUrl('api-statistics-outs', {
        start_time: req.query.outs_start_time || '2020-06-01',
        end_time: req.query.outs_end_time || '2020-06-01',
        api_key: CPX_API_KEY
      })
    },
    {
      id: 'validate-transaction',
      label: 'Validate Transaction',
      description: 'Check whether a transaction ID is valid.',
      url: buildCpxApiUrl('api-check-transaction-id', {
        transaction_id: req.query.transaction_id || 'XXXXXX',
        api_key: CPX_API_KEY
      })
    }
  ];

  return res.json({
    api_key: CPX_API_KEY,
    base_url: CPX_BASE_URL,
    default_params: defaultParams,
    endpoints
  });
});

// GET /api/cpx/embed/:page - render the CPX page inside an iframe wrapper
router.get('/embed/:page', (req, res) => {
  const pageName = req.params.page;
  const defaultParams = getDefaultCpxParams(req);
  const params = { ...defaultParams, ...req.query };

  const url = buildCpxApiUrl(pageName, {
    api_key: CPX_API_KEY,
    ...params
  });

  const html = `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>CPX: ${pageName}</title>
        <style>
          html, body { margin: 0; background: #0b0c0f; height: 100%; }
          body { display: flex; align-items: stretch; justify-content: center; }
          iframe { width: 100%; height: 100vh; border: 0; background: #111; }
        </style>
      </head>
      <body>
        <iframe src="${url}" title="CPX ${pageName}"></iframe>
      </body>
    </html>`;

  return res.type('html').send(html);
});

module.exports = router;
