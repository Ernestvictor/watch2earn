const express = require('express');
const router = express.Router();
const User = require('../models/User');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRANSACTIONS_PATH = path.join(DATA_DIR, 'transactions.json');
const MESSAGES_PATH = path.join(DATA_DIR, 'messages.json');

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TRANSACTIONS_PATH)) fs.writeFileSync(TRANSACTIONS_PATH, '[]');
  if (!fs.existsSync(MESSAGES_PATH)) fs.writeFileSync(MESSAGES_PATH, '[]');
}

function readJson(file) {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  ensureDataFiles();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

router.post('/watch-ad', async (req, res) => {
  try {
    const { firebaseUid, amount = 10 } = req.body;

    // 1. Get user
    const user = await User.findOne({ firebaseUid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isBanned) return res.status(403).json({ error: 'User is banned' });

    // 2. Update wallet
    user.wallet += amount;
    await user.save();

    // 3. Record transaction in JSON
    const transactions = readJson(TRANSACTIONS_PATH);
    transactions.push({
      id: Date.now().toString(),
      userId: user._id.toString(),
      firebaseUid,
      amount,
      type: 'ad',
      date: new Date().toISOString()
    });
    writeJson(TRANSACTIONS_PATH, transactions);

    // 4. Record message in JSON
    const messages = readJson(MESSAGES_PATH);
    messages.push({
      id: Date.now().toString(),
      userId: user._id.toString(),
      firebaseUid,
      message: `You earned ₦${amount} for watching an ad`,
      type: 'earning',
      createdAt: new Date().toISOString()
    });
    writeJson(MESSAGES_PATH, messages);

    res.json({ success: true, newWallet: user.wallet });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Lightweight admin helpers (file-backed) ---
function readDataFile(filename, fallback = []) {
  ensureDataFiles();
  const p = path.join(DATA_DIR, filename);
  try {
    if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(fallback, null, 2));
    return JSON.parse(fs.readFileSync(p, 'utf8') || '[]');
  } catch (e) {
    return fallback;
  }
}

function writeDataFile(filename, data) {
  ensureDataFiles();
  const p = path.join(DATA_DIR, filename);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

// Admin login (simple local check - frontend expects some response)
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });
  // NOTE: replace with real auth in production
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    return res.json({ ok: true, token: 'admin-local-token' });
  }
  return res.status(403).json({ error: 'Invalid credentials' });
});

// List users (file fallback)
router.get('/users', (req, res) => {
  try {
    const users = readDataFile('users.json', []);
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read users' });
  }
});

// Messages
router.get('/messages', (req, res) => {
  try {
    const messages = readDataFile('messages.json', []);
    res.json(messages);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read messages' });
  }
});

router.post('/reply-message/:id', (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const messages = readDataFile('messages.json', []);
    const msg = messages.find(m => String(m.id) === String(id));
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    msg.replies = msg.replies || [];
    msg.replies.push({ reply: body.reply || '', by: body.by || 'admin', date: new Date().toISOString() });
    writeDataFile('messages.json', messages);
    res.json({ ok: true, message: msg });
  } catch (e) {
    res.status(500).json({ error: 'Failed to reply' });
  }
});

// Withdrawals (admin list)
router.get('/withdrawals', (req, res) => {
  try {
    const data = readDataFile('withdrawals.json', []);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read withdrawals' });
  }
});

// History / transactions
router.get('/history', (req, res) => {
  try {
    const tx = readDataFile('transactions.json', []);
    res.json(tx);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read history' });
  }
});

// Dashboard summary
router.get('/dashboard', (req, res) => {
  try {
    const users = readDataFile('users.json', []);
    const tx = readDataFile('transactions.json', []);
    const totalUsers = users.length;
    const totalTransactions = tx.length;
    const totalEarnedUsd = tx.reduce((s,t)=>s + Number(t.amountUsd || 0), 0);
    res.json({ totalUsers, totalTransactions, totalEarnedUsd });
  } catch (e) {
    res.status(500).json({ error: 'Failed to compute dashboard' });
  }
});

// Bonuses list and send
router.get('/bonuses', (req, res) => {
  try {
    const bonuses = readDataFile('bonuses.json', []);
    res.json(bonuses);
  } catch (e) { res.status(500).json({ error: 'Failed to read bonuses' }); }
});

router.post('/send-bonus', (req, res) => {
  try {
    const b = req.body || {};
    const bonuses = readDataFile('bonuses.json', []);
    const entry = { id: Date.now().toString(), ...b, createdAt: new Date().toISOString(), claimed: false };
    bonuses.unshift(entry);
    writeDataFile('bonuses.json', bonuses);
    res.json({ ok: true, bonus: entry });
  } catch (e) { res.status(500).json({ error: 'Failed to send bonus' }); }
});

// Leaderboard (top by wallet or totalEarned)
router.get('/leaderboard', (req, res) => {
  try {
    const users = readDataFile('users.json', []);
    const top = users.sort((a,b)=> (b.wallet || 0) - (a.wallet || 0)).slice(0,50);
    res.json(top);
  } catch (e) { res.status(500).json({ error: 'Failed to read leaderboard' }); }
});

// Simple chart data endpoints (mocked from transactions)
router.get('/chart/earnings', (req, res) => {
  try {
    const tx = readDataFile('transactions.json', []);
    // aggregate by day (last 7 days)
    const now = Date.now();
    const days = Array.from({length:7}).map((_,i)=>{
      const date = new Date(now - (6-i)*24*60*60*1000);
      const key = date.toISOString().slice(0,10);
      const total = tx.filter(t=> (t.date||'').slice(0,10)===key).reduce((s,t)=>s+Number(t.amountUsd||0),0);
      return { date: key, total };
    });
    res.json(days);
  } catch (e) { res.status(500).json({ error: 'Failed to build chart' }); }
});

router.get('/chart/ads-watched', (req, res) => {
  try {
    const tx = readDataFile('transactions.json', []);
    const count = tx.filter(t=> (t.type||'').toLowerCase().includes('ad')).length;
    res.json({ adsWatched: count });
  } catch (e) { res.status(500).json({ error: 'Failed to build ads chart' }); }
});

router.get('/chart/earnings-summary', (req, res) => {
  try {
    const tx = readDataFile('transactions.json', []);
    const summary = tx.reduce((acc,t)=>{ acc.totalUsd += Number(t.amountUsd||0); return acc; }, { totalUsd:0 });
    res.json(summary);
  } catch (e) { res.status(500).json({ error: 'Failed to build earnings summary' }); }
});

module.exports = router;
