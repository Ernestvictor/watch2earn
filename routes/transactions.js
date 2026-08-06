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
  const balanceUsd = transactions.reduce((sum, t) => sum + (Number(t.amountUsd) || 0), 0);
  const balanceNaira = Math.round(balanceUsd * 1500);
  const adCount = transactions.filter(t => t.type === 'ad' && isToday(t.date)).length;
  res.json({ balanceUsd, balanceNaira, adCount });
});

router.get('/history', verifyToken, (req, res) => {
  const userId = req.user.uid || req.user.id;
  const transactions = loadTransactions().filter(t => t.userId === userId);
  res.json(transactions);
});

module.exports = router;
