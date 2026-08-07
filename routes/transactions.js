const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const verifyToken = require('../middleware/auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TXN_PATH = path.join(DATA_DIR, 'transactions.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');

function ensureFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TXN_PATH)) fs.writeFileSync(TXN_PATH, '[]');
  if (!fs.existsSync(SETTINGS_PATH)) fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ dailyAdLimit: 5, bonusAdCount: 0, lastAnnouncement: '' }, null, 2));
  if (!fs.existsSync(USERS_PATH)) fs.writeFileSync(USERS_PATH, '[]');
}

function loadTransactions() {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(TXN_PATH, 'utf8')); } catch (e) { return []; }
}

function saveTransactions(items) {
  ensureFiles();
  fs.writeFileSync(TXN_PATH, JSON.stringify(items, null, 2));
}

function loadSettings() {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch (e) { return { dailyAdLimit: 5, bonusAdCount: 0, lastAnnouncement: '' }; }
}

function loadUsers() {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); } catch (e) { return []; }
}

function saveUsers(items) {
  ensureFiles();
  fs.writeFileSync(USERS_PATH, JSON.stringify(items, null, 2));
}

// alias expected by other modules
function writeUsers(items){ return saveUsers(items); }

function isToday(value) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

// POST /api/transactions/earn
router.post('/earn', verifyToken, (req, res) => {
  const { nairaAmount, source, title, referrerId } = req.body;
  const userId = req.user.uid || req.user.id;
  const settings = loadSettings();
  const dailyLimit = Number(settings.dailyAdLimit || 5);

  const transactions = loadTransactions();
  const adCount = transactions.filter(t => t.userId === userId && t.type === 'ad' && isToday(t.date)).length;

  if (adCount >= dailyLimit) {
    return res.status(403).json({ error: `Daily ad limit reached (${dailyLimit}/day, resets at 12:00 AM)` });
  }

  const usdAmount = Number(nairaAmount || 0) / 1500;
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

  transactions.unshift(newTx);
  saveTransactions(transactions);

  // If there's a referrer, add 10% referral bonus to referrer
  if (referrerId) {
    const referralBonus = usdAmount * 0.1; // 10% referral earnings
    const referralTx = {
      id: Date.now().toString() + '_ref',
      userId: referrerId,
      type: 'referral',
      source: 'referral',
      title: `Referral bonus from ${userId.slice(0, 8)}...`,
      amountUsd: referralBonus,
      amountNaira: Math.round(referralBonus * 1500),
      date: new Date().toISOString(),
      referredUserId: userId
    };
    transactions.unshift(referralTx);
    saveTransactions(transactions);
  }

  res.json({ message: 'Ad watched successfully', amount: usdAmount, remaining: Math.max(dailyLimit - adCount - 1, 0) });
});

// POST /api/transactions/claim-strike - Claim daily strike bonus
router.post('/claim-strike', verifyToken, (req, res) => {
  const userId = req.user.uid || req.user.id;
  const transactions = loadTransactions();
  
  // Check if user already claimed strike today
  const strikeToday = transactions.find(t => t.userId === userId && t.type === 'strike' && isToday(t.date));
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

  transactions.unshift(strikeTx);
  saveTransactions(transactions);

  res.json({ message: 'Daily strike claimed', amount: 0.01 });
});

// GET /api/transactions/referral-earnings - Get total referral earnings
router.get('/referral-earnings', verifyToken, (req, res) => {
  const userId = req.user.uid || req.user.id;
  const transactions = loadTransactions();
  const referralEarnings = transactions
    .filter(t => t.userId === userId && t.type === 'referral')
    .reduce((sum, t) => sum + (t.amountUsd || 0), 0);

  res.json({ referralEarningsUsd: referralEarnings, referralEarningsNaira: Math.round(referralEarnings * 1500) });
});

router.get('/balance', verifyToken, (req, res) => {
  const userId = req.user.uid || req.user.id;
  const transactions = loadTransactions().filter(t => t.userId === userId);
  // compute breakdown by type
  const breakdown = transactions.reduce((acc, t) => {
    const type = (t.type || 'other').toLowerCase();
    acc.totalUsd += Number(t.amountUsd || 0);
    acc.totalNaira += Number(t.amountNaira || Math.round((t.amountUsd||0) * 1500));
    if (type.includes('ad')) acc.adsUsd += Number(t.amountUsd || 0);
    if (type.includes('referral') || type.includes('commission')) acc.referralUsd += Number(t.amountUsd || 0);
    if (type.includes('bonus') || type === 'signup_bonus' || type === 'consecutive_bonus') acc.bonusUsd += Number(t.amountUsd || 0);
    if (type.includes('game')) acc.gameUsd += Number(t.amountUsd || 0);
    if (type.includes('survey')) acc.surveyUsd += Number(t.amountUsd || 0);
    if (type.includes('withdraw')) acc.withdrawalsUsd += Number(t.amountUsd || 0);
    return acc;
  }, { totalUsd:0, totalNaira:0, adsUsd:0, referralUsd:0, bonusUsd:0, gameUsd:0, surveyUsd:0, withdrawalsUsd:0 });

  const adCount = transactions.filter(t => (t.type && t.type.toLowerCase().includes('ad')) && isToday(t.date)).length;

  res.json({
    balanceUsd: +breakdown.totalUsd.toFixed(6),
    balanceNaira: Math.round(breakdown.totalUsd * 1500),
    adsEarnUsd: +breakdown.adsUsd.toFixed(6),
    referralEarnUsd: +breakdown.referralUsd.toFixed(6),
    bonusEarnUsd: +breakdown.bonusUsd.toFixed(6),
    gameEarnUsd: +breakdown.gameUsd.toFixed(6),
    surveyEarnUsd: +breakdown.surveyUsd.toFixed(6),
    withdrawalsUsd: +breakdown.withdrawalsUsd.toFixed(6),
    adCount
  });
});

router.get('/history', verifyToken, (req, res) => {
  const userId = req.user.uid || req.user.id;
  const transactions = loadTransactions().filter(t => t.userId === userId);
  res.json(transactions);
});

// POST /api/transactions/signup-bonus - Award signup bonus once and referral small bonus
router.post('/signup-bonus', verifyToken, (req, res) => {
  const userId = req.user.uid || req.user.id;
  const users = loadUsers();
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
  }

  res.json({ message: 'Signup bonus granted', amountUsd: usd });
});

// Consecutive claim bonus endpoints
router.get('/consecutive-status', verifyToken, (req, res) => {
  const userId = req.user.uid || req.user.id;
  const users = loadUsers();
  const u = users.find(x => x.id === userId) || {};
  const consecutive = (u.consecutiveBonus && u.consecutiveBonus.streak) || 0;
  res.json({ streak: consecutive });
});

router.post('/claim-consecutive', verifyToken, (req, res) => {
  const userId = req.user.uid || req.user.id;
  const users = loadUsers();
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

  // Update user record
  u.consecutiveBonus = { streak, lastClaim: now.toISOString() };
  writeUsers(users);

  res.json({ success: true, streak, reward });
});

// GET /api/user/bonuses - Get user's available bonuses
router.get('/bonuses', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;
  try {
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

    // Add bonus to user's transactions
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
    res.status(500).json({ error: 'Failed to claim bonus' });
  }
});

module.exports = router;
