const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const verifyToken = require('../middleware/auth');
const mongoNative = require('../mongodb');
const { getRate } = require('../config/exchange');
const User = require('../models/users');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');

// Simple in-memory rate limiter for bonus claims (per-process)
const CLAIM_RATE = {};
const CLAIM_WINDOW_MS = Number(process.env.CLAIM_WINDOW_MS || 60 * 60 * 1000); // 1 hour default
const CLAIM_MAX = Number(process.env.CLAIM_MAX || 5); // max claims per window

function isRateLimited(userId) {
  if (!userId) return false;
  const now = Date.now();
  CLAIM_RATE[userId] = CLAIM_RATE[userId] || [];
  // keep only timestamps within window
  CLAIM_RATE[userId] = CLAIM_RATE[userId].filter(ts => (now - ts) <= CLAIM_WINDOW_MS);
  if (CLAIM_RATE[userId].length >= CLAIM_MAX) return true;
  CLAIM_RATE[userId].push(now);
  return false;
}

async function logClaimError(obj) {
  try {
    if (mongoNative && typeof mongoNative.getCollection === 'function') {
      const col = mongoNative.getCollection('claim_errors');
      await col.insertOne({ ...obj, time: new Date() });
      return;
    }
    if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
      const col = mongoose.connection.collection('claim_errors');
      await col.insertOne({ ...obj, time: new Date() });
      return;
    }
  } catch (e) { /* fall through */ }
  console.warn('Claim error (no mongo):', obj);
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const TXN_PATH = path.join(DATA_DIR, 'transactions.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');

async function loadTransactions() {
  if (mongoNative && typeof mongoNative.getTransactionsCollection === 'function') {
    const col = mongoNative.getTransactionsCollection();
    return await col.find({}).sort({ createdAt: -1 }).limit(10000).toArray();
  }
  if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
    const col = mongoose.connection.collection('transactions');
    return await col.find({}).sort({ createdAt: -1 }).limit(10000).toArray();
  }
  throw new Error('MongoDB required: transactions migrated to MongoDB only');
}

async function saveTransactions(items) {
  if (mongoNative && typeof mongoNative.getTransactionsCollection === 'function') {
    // Prefer atomic inserts via insertTxMongo; this function can be a noop for Mongo.
    return;
  }
  if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
    // No-op: inserts should be done via insertTxMongo
    return;
  }
  throw new Error('MongoDB required: transactions migrated to MongoDB only');
}

// Try to insert a transaction into MongoDB native collection when available
async function insertTxMongo(tx) {
  try {
    const col = mongoNative.getTransactionsCollection();
    // ensure a createdAt field for consistency with other inserts
    const doc = Object.assign({}, tx, { createdAt: tx.date ? new Date(tx.date) : new Date() });
    await col.insertOne(doc);
  } catch (e) {
    // Mongo not connected or insert failed — keep using file storage as primary
    // console.debug('Mongo insertTxMongo skipped:', e && e.message);
  }
}

async function loadSettings() {
  // Read settings from MongoDB `settings` collection (single doc)
  if (mongoNative && typeof mongoNative.getCollection === 'function') {
    const col = mongoNative.getCollection('settings');
    const doc = await col.findOne({});
    return doc || { dailyAdLimit: 5, bonusAdCount: 0, lastAnnouncement: '' };
  }
  if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
    const col = mongoose.connection.collection('settings');
    const doc = await col.findOne({});
    return doc || { dailyAdLimit: 5, bonusAdCount: 0, lastAnnouncement: '' };
  }
  throw new Error('MongoDB required for settings');
}

async function loadUsers() {
  if (mongoNative && typeof mongoNative.getUsersCollection === 'function') {
    const col = mongoNative.getUsersCollection();
    return await col.find({}).toArray();
  }
  if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
    return await User.find({}).lean();
  }
  throw new Error('MongoDB required for users');
}

async function saveUsers(items) {
  if (mongoNative && typeof mongoNative.getUsersCollection === 'function') {
    const col = mongoNative.getUsersCollection();
    for (const u of items || []) {
      const filter = u.email ? { email: u.email } : (u.firebaseUid ? { firebaseUid: u.firebaseUid } : null);
      if (!filter) continue;
      await col.updateOne(filter, { $set: u }, { upsert: true });
    }
    return;
  }
  if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
    for (const u of items || []) {
      const filter = u.email ? { email: u.email } : (u.firebaseUid ? { firebaseUid: u.firebaseUid } : null);
      if (!filter) continue;
      await User.updateOne(filter, { $set: u }, { upsert: true });
    }
    return;
  }
  throw new Error('MongoDB required to save users');
}

// alias expected by other modules
function writeUsers(items){ return saveUsers(items); }

async function findUserByAnyId(userId, email = null) {
  const filters = [];
  const candidates = [userId, email].filter(Boolean).map(String);
  for (const value of candidates) {
    filters.push({ firebaseUid: value }, { uid: value }, { id: value }, { email: value });
  }
  if (!filters.length) return null;

  try {
    if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
      return await User.findOne({ $or: filters }).lean();
    }
  } catch (e) {
    console.warn('findUserByAnyId failed:', e && e.message);
  }
  return null;
}

async function creditLiveUserWallet(userId, amountNaira, options = {}) {
  const amount = Number(amountNaira || 0);
  if (!userId || !Number.isFinite(amount) || amount === 0) return null;

  const email = options.email || null;
  const filter = { $or: [{ firebaseUid: String(userId) }, { uid: String(userId) }, { id: String(userId) }, { email: String(userId) }] };
  if (email) {
    filter.$or.push({ email: String(email) });
  }

  try {
    const record = await User.findOneAndUpdate(
      filter,
      {
        $inc: { wallet: amount, balance: amount, totalEarned: amount },
        $set: { updatedAt: new Date() },
        $setOnInsert: {
          firebaseUid: String(userId),
          email: String(email || `${String(userId).replace(/[@.]/g, '_')}@local.user`),
          displayName: String(userId),
          wallet: 0,
          balance: 0,
          totalEarned: 0,
          status: 'active'
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    return record;
  } catch (e) {
    console.warn('creditLiveUserWallet failed:', e && e.message);
    return null;
  }
}

async function creditUserWallet(userId, amountNaira) {
  if (!userId || !Number.isFinite(Number(amountNaira)) || Number(amountNaira) === 0) return null;
  return creditLiveUserWallet(userId, Number(amountNaira), { email: null });
}

function findCurrentBalanceForUser(userId) {
  if (!userId) return 0;
  const user = User && typeof User.findOne === 'function' ? User.findOne({ $or: [{ firebaseUid: userId }, { uid: userId }, { id: userId }, { email: userId }] }) : null;
  return user ? Number(user.wallet || user.balance || 0) : 0;
}

function isToday(value) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

// POST /api/transactions/earn
router.post('/earn', verifyToken, async (req, res) => {
  const { nairaAmount, source, title, referrerId } = req.body;
  const userId = req.user.uid || req.user.id;
  let settings;
  try { settings = await loadSettings(); } catch (e) { return res.status(503).json({ error: 'MongoDB required for transactions' }); }
  const dailyLimit = Number(settings.dailyAdLimit || 5);

    const transactions = await loadTransactions();
  const adCount = transactions.filter(t => t.userId === userId && t.type === 'ad' && isToday(t.date)).length;

  if (adCount >= dailyLimit) {
    return res.status(403).json({ error: `Daily ad limit reached (${dailyLimit}/day, resets at 12:00 AM)` });
  }

  let usdAmount;
  try { usdAmount = Number(nairaAmount || 0) / getRate(); } catch (e) { console.error('Exchange rate error:', e.message); return res.status(500).json({ error: 'Server misconfiguration: exchange rate' }); }
  const newTx = {
    id: Date.now().toString(),
    userId,
    type: 'ad',
    source: source || 'video',
    title: title || 'Watched Ad',
    amountUsd: usdAmount,
    amountNaira: Number(nairaAmount || 0),
    date: new Date().toISOString(),
    referrerId: referrerId || null
  };

    // Persist transaction (Mongo preferred)
    await insertTxMongo(newTx).catch(() => {});
    // keep file fallback in sync when Mongo is not available
    transactions.unshift(newTx);
    await saveTransactions(transactions);

  // Update user wallet in MongoDB only
  try {
    await creditLiveUserWallet(userId, Number(nairaAmount || 0), { email: req.user.email, source: 'ad' });
  } catch (e) { console.warn('MongoDB wallet update failed:', e?.message); }

  // If there's a referrer, add 10% referral bonus to referrer
  if (referrerId) {
    let exchangeRate;
    try { exchangeRate = getRate(); } catch (e) { console.error('Exchange rate error:', e.message); return res.status(500).json({ error: 'Server misconfiguration: exchange rate' }); }
    const referralBonus = usdAmount * 0.1; // 10% referral earnings
    const referralTx = {
      id: Date.now().toString() + '_ref',
      userId: referrerId,
      type: 'referral',
      source: 'referral',
      title: `Referral bonus from ${userId.slice(0, 8)}...`,
      amountUsd: referralBonus,
      amountNaira: Math.round(referralBonus * exchangeRate),
      date: new Date().toISOString(),
      referredUserId: userId
    };
      await insertTxMongo(referralTx).catch(() => {});
      transactions.unshift(referralTx);
      await saveTransactions(transactions);

    const referralNaira = Math.round(referralBonus * exchangeRate);
    try {
      await creditLiveUserWallet(referrerId, referralNaira, { email: null, source: 'referral' });
    } catch (e) { console.warn('Referrer wallet update failed:', e?.message); }
  }

  res.json({ message: 'Ad watched successfully', amount: usdAmount, remaining: Math.max(dailyLimit - adCount - 1, 0) });
});

// POST /api/transactions/bonuses/claim - user claims a bonus
router.post('/bonuses/claim', verifyToken, async (req, res) => {
  try {
    const bonusId = (req.body && (req.body.id || req.body.bonusId)) || null;
    if (!bonusId) return res.status(400).json({ error: 'bonus id is required' });

    const userId = req.user.uid || req.user.id;
    if (!userId) return res.status(400).json({ error: 'user id missing from token' });

    // Rate limit per user to prevent abuse
    if (isRateLimited(String(userId))) {
      logClaimError({ userId: String(userId), bonusId: String(bonusId), error: 'rate_limited' });
      return res.status(429).json({ error: 'Rate limit exceeded' });
    }

    // Use MongoDB only (no file fallback)
    const bonusCol = mongoNative.getCollection('bonuses');
    const orQuery = [{ id: bonusId }];
    try { orQuery.push({ _id: new ObjectId(bonusId) }); } catch (e) { /* not an ObjectId */ }
    const bonus = await bonusCol.findOne({ $or: orQuery });
    if (!bonus) return res.status(404).json({ error: 'Bonus not found' });

    const claimedBy = Array.isArray(bonus.claimedBy) ? bonus.claimedBy.map(String) : [];
    // Determine eligibility
    const targetType = String(bonus.targetType || 'all');
    const targetUserId = bonus.targetUserId || bonus.targetUser || null;
    const targetUsers = Array.isArray(bonus.targetUsers) ? bonus.targetUsers : [];

    const eligible = (targetType === 'all') || (targetUserId && String(targetUserId) === String(userId)) || targetUsers.includes(userId);
    if (!eligible) return res.status(403).json({ error: 'You are not eligible for this bonus' });
    if (claimedBy.includes(String(userId))) return res.status(400).json({ error: 'Bonus already claimed by you' });

    // Check expiry
    const now = new Date();
    const expiresAt = bonus.expiresAt || bonus.expires || bonus.expiry || bonus.expires_at || null;
    if (expiresAt) {
      const expDate = new Date(expiresAt);
      if (!isNaN(expDate) && expDate < now) return res.status(400).json({ error: 'Bonus expired' });
    }

    // Prevent duplicate claims (race-safe check using transactions collection)
    const referenceId = String(bonus.id || bonus._id || bonusId);
    try {
      const txCol = mongoNative.getTransactionsCollection();
      const existing = await txCol.findOne({ userId: String(userId), referenceId });
      if (existing) return res.status(400).json({ error: 'Bonus already claimed' });
    } catch (e) {
      console.warn('Duplicate-check failed:', e.message);
    }

    // Determine amount (prefer amountUsd then amount)
    const amountUsd = Number(bonus.amountUsd ?? bonus.amount ?? 0) || 0;
    if (amountUsd <= 0) {
      return res.status(400).json({ error: 'Invalid bonus amount' });
    }
    const exchangeRate = Number(process.env.USD_TO_NAIRA_RATE || 1500);
    const amountNaira = Math.round(amountUsd * exchangeRate);

    // Credit user wallet using helper (upsert + atomic $inc) — MongoDB only
    const credited = await creditLiveUserWallet(userId, amountNaira, { email: req.user && req.user.email ? req.user.email : null, source: 'bonus_claim' });
    if (!credited) return res.status(500).json({ error: 'Failed to credit user wallet (MongoDB unavailable)' });

    // Record transaction in MongoDB only
    const tx = {
      id: Date.now().toString(),
      userId,
      type: 'bonus',
      title: bonus.title || 'Claimed bonus',
      amountUsd,
      amountNaira,
      referenceId,
      date: new Date().toISOString()
    };
    await insertTxMongo(tx);

    // Update bonus doc claimedBy
    try {
      await bonusCol.updateOne({ $or: orQuery }, { $addToSet: { claimedBy: String(userId) }, $set: { updatedAt: new Date() } });
    } catch (e) { console.warn('Failed to update bonus claimedBy:', e.message); }

    return res.json({ ok: true, credited: amountNaira, amountUsd, tx });
  } catch (error) {
    console.error('Bonus claim error:', error);
    logClaimError({ error: error && error.message ? error.message : String(error) });
    return res.status(500).json({ error: 'Failed to claim bonus' });
  }
});

// GET /api/transactions/bonuses - list bonuses available to current user
router.get('/bonuses', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    if (!userId) return res.status(400).json({ error: 'user id missing from token' });

    // Mongo first
    if (mongoNative && typeof mongoNative.getCollection === 'function') {
      const bonusCol = mongoNative.getCollection('bonuses');
      const raw = await bonusCol.find({}).sort({ createdAt: -1 }).limit(100).toArray();
      const bonuses = (raw || []).map(b => {
        const claimedBy = Array.isArray(b.claimedBy) ? b.claimedBy.map(String) : [];
        return {
          id: b.id || b._id?.toString?.(),
          title: b.title || b.description || 'Bonus',
          amountUsd: Number(b.amountUsd ?? b.amount ?? 0) || 0,
          targetType: b.targetType || 'all',
          targetUserId: b.targetUserId || b.targetUser || null,
          targetUsers: Array.isArray(b.targetUsers) ? b.targetUsers : [],
          claimed: claimedBy.includes(String(userId)),
          createdAt: b.createdAt || b.createdAt || null
        };
      });
      return res.json({ bonuses });
    }

    // Fallback to file-based bonuses
    const bonusesPath = path.join(DATA_DIR, 'bonuses.json');
    let bonuses = [];
    try { bonuses = JSON.parse(fs.readFileSync(bonusesPath, 'utf8') || '[]'); } catch (e) { bonuses = []; }
    const mapped = (bonuses || []).map(b => ({
      id: b.id,
      title: b.title || b.description || 'Bonus',
      amountUsd: Number(b.amountUsd ?? b.amount ?? 0) || 0,
      targetType: b.targetType || 'all',
      targetUserId: b.targetUserId || b.targetUser || null,
      targetUsers: Array.isArray(b.targetUsers) ? b.targetUsers : [],
      claimed: Array.isArray(b.claimedBy) ? b.claimedBy.map(String).includes(String(userId)) : false,
      createdAt: b.createdAt || null
    }));
    return res.json({ bonuses: mapped });
  } catch (err) {
    console.error('List bonuses error:', err);
    return res.status(500).json({ error: 'Failed to list bonuses' });
  }
});

// POST /api/transactions/claim-strike - Claim daily strike bonus
router.post('/claim-strike', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;
  const transactions = await loadTransactions();
  
  // Check if user already claimed strike today
  const strikeToday = (transactions || []).find(t => t.userId === userId && t.type === 'strike' && isToday(t.date));
  if (strikeToday) {
    return res.status(403).json({ error: 'Daily strike already claimed today' });
  }

  const strikeTx = {
    id: Date.now().toString(),
    userId,
    type: 'strike',
    source: 'daily_strike',
    title: 'Daily Strike Bonus',
    amountUsd: 0.01,
    amountNaira: 15,
    date: new Date().toISOString()
  };

  await insertTxMongo(strikeTx).catch(() => {});
  transactions.unshift(strikeTx);
  await saveTransactions(transactions);

  res.json({ message: 'Daily strike claimed', amount: 0.01 });
});

// GET /api/transactions/referral-earnings - Get total referral earnings
router.get('/referral-earnings', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;
  try {
    if (typeof mongoNative.getTransactionsCollection === 'function') {
      const col = mongoNative.getTransactionsCollection();
      const docs = await col.find({ userId }).toArray();
      const exchangeRate = Number(process.env.USD_TO_NAIRA_RATE || 1500);
      const referralEarnings = docs.filter(t => t.type === 'referral').reduce((s, t) => s + (Number(t.amountUsd || 0)), 0);
      return res.json({ referralEarningsUsd: referralEarnings, referralEarningsNaira: Math.round(referralEarnings * exchangeRate) });
    }
  } catch (e) {
    console.error('Mongo referral-earnings read failed:', e && e.message);
  }

  // Fallback to file storage
  const transactions = loadTransactions();
  const exchangeRate = Number(process.env.USD_TO_NAIRA_RATE || 1500);
  const referralEarnings = transactions
    .filter(t => t.userId === userId && t.type === 'referral')
    .reduce((sum, t) => sum + (t.amountUsd || 0), 0);

  res.json({ referralEarningsUsd: referralEarnings, referralEarningsNaira: Math.round(referralEarnings * exchangeRate) });
});

// GET /api/transactions/balance - Return user's current wallet balance + earnings breakdown
router.get('/balance', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;
  console.log('[BALANCE] userId:', userId, '| MongoDB ready:', mongoose?.connection?.readyState === 1);
  
  const zeroBreakdown = {
    totalUsd: 0,
    totalNaira: 0,
    adsUsd: 0,
    referralUsd: 0,
    bonusUsd: 0,
    gameUsd: 0,
    surveyUsd: 0,
    withdrawalsUsd: 0
  };

  // Try MongoDB first
  try {
    if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
      console.log('[BALANCE] Querying MongoDB for user...');
      const user = await User.findOne({ $or: [{ firebaseUid: userId }, { uid: userId }, { id: userId }] }).lean();
      
      if (!user) {
        console.log('[BALANCE] User not found in MongoDB, trying file fallback');
      } else {
        console.log('[BALANCE] ✓ User found | wallet:', user.wallet, 'balance:', user.balance);

        const exchangeRate = Number(process.env.USD_TO_NAIRA_RATE || 1500);
        const walletNaira = Number(user.wallet || user.balance || 0);
        const walletUsd = +(walletNaira / exchangeRate).toFixed(6);

        let docs = [];
        try {
          const col = mongoNative && typeof mongoNative.getTransactionsCollection === 'function' ? mongoNative.getTransactionsCollection() : null;
          if (col) docs = await col.find({ userId: String(userId) }).toArray();
          console.log('[BALANCE] Found', docs.length, 'transactions');
        } catch (e) {
          console.warn('[BALANCE] Transaction fetch failed:', e?.message);
        }

        const breakdown = docs.reduce((acc, t) => {
          const type = (t.type || 'other').toLowerCase();
          const amountUsd = Number(t.amountUsd || t.amount || 0);
          acc.totalUsd += amountUsd;
          acc.totalNaira += Math.round(amountUsd * 1500);
          if (type.includes('ad')) acc.adsUsd += amountUsd;
          if (type.includes('referral') || type.includes('commission')) acc.referralUsd += amountUsd;
          if (type.includes('bonus') || type === 'signup_bonus') acc.bonusUsd += amountUsd;
          if (type.includes('game')) acc.gameUsd += amountUsd;
          if (type.includes('survey')) acc.surveyUsd += amountUsd;
          if (type.includes('withdraw')) acc.withdrawalsUsd += amountUsd;
          return acc;
        }, JSON.parse(JSON.stringify(zeroBreakdown)));

        const adCount = docs.filter(t => t.type && String(t.type).toLowerCase().includes('ad') && isToday(t.date)).length;

        const response = {
          balanceUsd: walletUsd,
          balanceNaira: walletNaira,
          adsEarnUsd: +breakdown.adsUsd.toFixed(6),
          referralEarnUsd: +breakdown.referralUsd.toFixed(6),
          bonusEarnUsd: +breakdown.bonusUsd.toFixed(6),
          gameEarnUsd: +breakdown.gameUsd.toFixed(6),
          surveyEarnUsd: +breakdown.surveyUsd.toFixed(6),
          withdrawalsUsd: +breakdown.withdrawalsUsd.toFixed(6),
          adCount,
          rate: 1500,
          source: 'mongodb'
        };
        console.log('[BALANCE] ✓ Returning from MongoDB:', response);
        return res.json(response);
      }
    } else {
      console.log('[BALANCE] MongoDB not ready, using file fallback');
    }
  } catch (e) {
    console.error('[BALANCE] MongoDB error:', e?.message);
  }

  // File-based fallback
  console.log('[BALANCE] Using file-based fallback');
  try {
    const allTx = loadTransactions().filter(t => String(t.userId) === String(userId) || String(t.firebaseUid || '') === String(userId));
    console.log('[BALANCE] Found', allTx.length, 'transactions in file');

    const breakdown = allTx.reduce((acc, t) => {
      const type = (t.type || 'other').toLowerCase();
      const amountUsd = Number(t.amountUsd || t.amount || 0);
      acc.totalUsd += amountUsd;
      acc.totalNaira += Math.round(amountUsd * 1500);
      if (type.includes('ad')) acc.adsUsd += amountUsd;
      if (type.includes('referral') || type.includes('commission')) acc.referralUsd += amountUsd;
      if (type.includes('bonus') || type === 'signup_bonus') acc.bonusUsd += amountUsd;
      if (type.includes('game')) acc.gameUsd += amountUsd;
      if (type.includes('survey')) acc.surveyUsd += amountUsd;
      if (type.includes('withdraw')) acc.withdrawalsUsd += amountUsd;
      return acc;
    }, JSON.parse(JSON.stringify(zeroBreakdown)));

    let walletNaira = 0;
    try {
      const usersData = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8') || '[]');
      const userRecord = usersData.find(u => String(u.id) === String(userId) || String(u.uid) === String(userId) || String(u.firebaseUid) === String(userId));
      if (userRecord) {
        walletNaira = Number(userRecord.wallet || userRecord.balance || 0);
        console.log('[BALANCE] Wallet from file:', walletNaira);
      } else {
        console.log('[BALANCE] User record not found in users file');
        walletNaira = 0;
      }
    } catch (e) {
      console.warn('[BALANCE] File wallet read error:', e?.message);
      walletNaira = 0;
    }

    const walletUsd = +(walletNaira / 1500).toFixed(6);
    const adCount = allTx.filter(t => t.type && String(t.type).toLowerCase().includes('ad') && isToday(t.date)).length;

    const response = {
      balanceUsd: walletUsd,
      balanceNaira: walletNaira,
      adsEarnUsd: +breakdown.adsUsd.toFixed(6),
      referralEarnUsd: +breakdown.referralUsd.toFixed(6),
      bonusEarnUsd: +breakdown.bonusUsd.toFixed(6),
      gameEarnUsd: +breakdown.gameUsd.toFixed(6),
      surveyEarnUsd: +breakdown.surveyUsd.toFixed(6),
      withdrawalsUsd: +breakdown.withdrawalsUsd.toFixed(6),
      adCount,
      rate: 1500,
      source: 'file'
    };
    console.log('[BALANCE] ✓ Returning from file:', response);
    return res.json(response);
  } catch (e) {
    console.error('[BALANCE] File fallback error:', e?.message);
    return res.status(500).json({ error: 'Failed to compute balance', details: e?.message });
  }
});

router.get('/history', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;
  try {
    if (typeof mongoNative.getTransactionsCollection === 'function') {
      const col = mongoNative.getTransactionsCollection();
      const docs = await col.find({ userId }).sort({ date: -1 }).toArray();
      return res.json(docs);
    }
  } catch (e) {
    console.error('Mongo history read failed:', e && e.message);
  }

  const transactions = loadTransactions().filter(t => t.userId === userId);
  res.json(transactions);
});

// POST /api/transactions/signup-bonus - Award signup bonus once and referral small bonus
router.post('/signup-bonus', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;
  let users;
  try { users = await loadUsers(); } catch (e) { return res.status(503).json({ error: 'MongoDB required' }); }
  let user = users.find(u => u.id === userId || u.uid === userId);
  if (!user) {
    user = { id: userId, createdAt: new Date().toISOString(), signupBonusGiven: false };
    users.unshift(user);
  }

  // Also check transactions to ensure we haven't already given a signup bonus (defense-in-depth)
  const existingTxs = loadTransactions();
  const existingSignup = existingTxs.find(t => (t.userId === userId) && (t.type === 'signup_bonus' || t.type === 'signup-bonus'));
  if (existingSignup || user.signupBonusGiven) {
    // Ensure the flag is consistent with transactions
    user.signupBonusGiven = true;
    writeUsers(users);
    return res.json({ message: 'Signup bonus already granted' });
  }

  // Give 100 NGN => convert to USD
  const naira = 100;
  const usd = +(naira / 1500).toFixed(6);
  const txs = existingTxs;
  const bonusTx = {
    id: Date.now().toString(),
    userId,
    type: 'signup_bonus',
    source: 'signup',
    title: 'Signup bonus',
    amountUsd: usd,
    amountNaira: naira,
    date: new Date().toISOString()
  };
  txs.unshift(bonusTx);
  saveTransactions(txs);
  insertTxMongo(bonusTx).catch(() => {});

  // Mark user as given
  user.signupBonusGiven = true;
  writeUsers(users);

  // If referrer id passed in body, give them 10 NGN
  const referrerId = req.body.referrerId;
  if (referrerId) {
    const refUsd = +(10 / 1500).toFixed(6);
    const refTx = {
      id: Date.now().toString() + '_ref',
      userId: referrerId,
      type: 'signup_referral',
      source: 'referral_signup',
      title: 'Invitee signup bonus',
      amountUsd: refUsd,
      amountNaira: 10,
      date: new Date().toISOString(),
      referredUserId: userId
    };
    txs.unshift(refTx);
    saveTransactions(txs);
    insertTxMongo(refTx).catch(() => {});
  }

  res.json({ message: 'Signup bonus granted', amountUsd: usd });
});

// Consecutive claim bonus endpoints
router.get('/consecutive-status', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;
  let users;
  try { users = await loadUsers(); } catch (e) { return res.status(503).json({ error: 'MongoDB required' }); }
  const u = users.find(x => x.id === userId) || {};
  const consecutive = (u.consecutiveBonus && u.consecutiveBonus.streak) || 0;
  res.json({ streak: consecutive });
});

router.post('/claim-consecutive', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;
  let users;
  try { users = await loadUsers(); } catch (e) { return res.status(503).json({ error: 'MongoDB required' }); }
  let u = users.find(x => x.id === userId);
  if (!u) { u = { id: userId }; users.unshift(u); }

  const now = new Date();
  const cb = u.consecutiveBonus || { streak: 0, lastClaim: null };
  const last = cb.lastClaim ? new Date(cb.lastClaim) : null;
  let streak = cb.streak || 0;

  // If last claim was yesterday, increment streak, if today already claimed -> error, else reset to 1
  if (last) {
    const diff = Math.floor((now - last) / (1000 * 60 * 60 * 24));
    if (diff === 0) return res.status(403).json({ error: 'Already claimed today' });
    if (diff === 1) streak = streak + 1; else streak = 1;
  } else {
    streak = 1;
  }

  // Reward tiers: days 1-7 => 0.001 USD, days 8-14 => 0.005, days 15-21 => 0.01
  let reward = 0.001;
  if (streak >= 8 && streak <= 14) reward = 0.005;
  if (streak >= 15) reward = 0.01;

  // Record transaction
  const txs = loadTransactions();
  const tx = {
    id: Date.now().toString(),
    userId,
    type: 'consecutive_bonus',
    source: 'consecutive_claim',
    title: `Consecutive bonus day ${streak}`,
    amountUsd: reward,
    amountNaira: Math.round(reward * 1500),
    date: now.toISOString()
  };
  txs.unshift(tx);
  saveTransactions(txs);
  insertTxMongo(tx).catch(() => {});

  // Update user record
  u.consecutiveBonus = { streak, lastClaim: now.toISOString() };
  writeUsers(users);

  res.json({ success: true, streak, reward });
});

// GET /api/user/bonuses - Get user's available bonuses
router.get('/bonuses', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;
  try {
    // If Mongo is connected, read bonuses from Mongo collection
    if (typeof mongoNative.getCollection === 'function') {
      try {
        const bcol = mongoNative.getCollection('bonuses');
        const docs = await bcol.find({ $or: [ { targetType: 'all' }, { targetUserId: userId }, { targetUsers: userId } ] , claimed: { $ne: true } }).toArray();
        return res.json({ bonuses: docs });
      } catch (e) {
        console.error('Mongo bonuses read failed:', e && e.message);
      }
    }

    // Fallback to file-based bonuses
    const bonusPath = path.join(DATA_DIR, 'bonuses.json');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(bonusPath)) fs.writeFileSync(bonusPath, '[]');
    const allBonuses = JSON.parse(fs.readFileSync(bonusPath, 'utf8'));
    const userBonuses = allBonuses.filter(b => 
      (b.targetType === 'all' || b.targetUserId === userId || (b.targetUsers && b.targetUsers.includes(userId))) &&
      !b.claimed
    );
    res.json({ bonuses: userBonuses });
  } catch (e) {
    console.error('Error loading bonuses:', e);
    res.json({ bonuses: [] });
  }
});

// POST /api/user/claim-bonus - Claim a bonus
router.post('/claim-bonus', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;
  const { bonusId } = req.body;
  
  if (!bonusId) return res.status(400).json({ error: 'Bonus ID required' });

  try {
    // Prefer Mongo for claiming bonuses
    if (typeof mongoNative.getCollection === 'function' && typeof mongoNative.getTransactionsCollection === 'function') {
      try {
        const bcol = mongoNative.getCollection('bonuses');
        const txCol = mongoNative.getTransactionsCollection();
        // Find and update atomically
        const result = await bcol.findOneAndUpdate(
          { id: bonusId, claimed: { $ne: true } },
          { $set: { claimed: true }, $push: { claimedBy: { userId, claimedAt: new Date() } } },
          { returnDocument: 'after' }
        );
        const bonus = result.value;
        if (!bonus) return res.status(404).json({ error: 'Bonus not found or already claimed' });

        // Eligibility checks
        if (bonus.targetType === 'specific' && bonus.targetUserId !== userId) {
          return res.status(403).json({ error: 'Not eligible for this bonus' });
        }

        // Insert transaction
        const bonusTx = {
          id: Date.now().toString(),
          userId,
          type: 'bonus',
          source: 'admin_bonus',
          title: bonus.title || 'Admin Bonus',
          amountUsd: bonus.amountUsd,
          amountNaira: Math.round((bonus.amountUsd || 0) * 1500),
          date: new Date(),
          bonusId: bonusId
        };
        await txCol.insertOne(bonusTx);
        return res.json({ message: 'Bonus claimed successfully', amount: bonus.amountUsd });
      } catch (mongoErr) {
        console.warn('MongoDB claim bonus failed, falling back to file:', mongoErr.message);
        // Fall through to file-based flow
      }
    }

    // Fallback to file-based flow
    const bonusPath = path.join(DATA_DIR, 'bonuses.json');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(bonusPath)) fs.writeFileSync(bonusPath, '[]');
    
    const allBonuses = JSON.parse(fs.readFileSync(bonusPath, 'utf8'));
    const bonus = allBonuses.find(b => b.id === bonusId);
    
    if (!bonus) return res.status(404).json({ error: 'Bonus not found' });
    if (bonus.claimed) return res.status(403).json({ error: 'Bonus already claimed' });

    // Check if user is eligible
    if (bonus.targetType === 'specific' && bonus.targetUserId !== userId) {
      return res.status(403).json({ error: 'Not eligible for this bonus' });
    }
    if (bonus.targetType !== 'all' && bonus.targetType !== 'specific') {
      return res.status(403).json({ error: 'Not eligible for this bonus' });
    }

    // Mark as claimed and record user claim
    bonus.claimed = true;
    bonus.claimedBy = bonus.claimedBy || [];
    bonus.claimedBy.push({ userId, claimedAt: new Date().toISOString() });
    
    fs.writeFileSync(bonusPath, JSON.stringify(allBonuses, null, 2));

    // Add bonus to user's transactions (file)
    const bonusTx = {
      id: Date.now().toString(),
      userId,
      type: 'bonus',
      source: 'admin_bonus',
      title: bonus.title || 'Admin Bonus',
      amountUsd: bonus.amountUsd,
      amountNaira: Math.round(bonus.amountUsd * 1500),
      date: new Date().toISOString(),
      bonusId: bonusId
    };

    const transactions = loadTransactions();
    transactions.unshift(bonusTx);
    saveTransactions(transactions);

    res.json({ message: 'Bonus claimed successfully', amount: bonus.amountUsd });
  } catch (e) {
    console.error('Error claiming bonus:', e);
    res.status(500).json({ error: 'Failed to claim bonus: ' + (e && e.message || 'unknown error') });
  }
});

module.exports = router;
