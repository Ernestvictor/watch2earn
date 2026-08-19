const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Earning = require('../models/earning');
const Message = require('../models/messeges');
const fs = require('fs');
const path = require('path');
const mongoNative = require('../mongodb');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRANSACTIONS_PATH = path.join(DATA_DIR, 'transactions.json');
const MESSAGES_PATH = path.join(DATA_DIR, 'messages.json');
const PROMOTIONS_PATH = path.join(DATA_DIR, 'promotions.json');
const nodemailer = (() => {
  try { return require('nodemailer'); } catch (e) { return null; }
})();

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TRANSACTIONS_PATH)) fs.writeFileSync(TRANSACTIONS_PATH, '[]');
  if (!fs.existsSync(MESSAGES_PATH)) fs.writeFileSync(MESSAGES_PATH, '[]');
  if (!fs.existsSync(PROMOTIONS_PATH)) fs.writeFileSync(PROMOTIONS_PATH, '[]');
}

function readPromotions() {
  ensureDataFiles();
  try { return JSON.parse(fs.readFileSync(PROMOTIONS_PATH, 'utf8') || '[]'); } catch (e) { return []; }
}

function writePromotions(items) {
  ensureDataFiles();
  fs.writeFileSync(PROMOTIONS_PATH, JSON.stringify(items, null, 2));
}

async function recordPromotionLog({ userId, email, code, status, method, adminEmail }) {
  const entry = {
    id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
    userId: userId || null,
    email: email || null,
    code: code || null,
    status: status || 'pending',
    method: method || 'email',
    adminEmail: adminEmail || null,
    createdAt: new Date().toISOString()
  };

  try {
    if (mongoNative && typeof mongoNative.getCollection === 'function') {
      const promoCol = mongoNative.getCollection('promotion_logs');
      await promoCol.insertOne(entry);
    }
  } catch (e) { /* silent fallback */ }

  const items = readPromotions();
  items.unshift(entry);
  writePromotions(items.slice(0, 200));
  return entry;
}

function readJson(file) {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  ensureDataFiles();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function isMongooseReady() {
  try {
    return mongoose && mongoose.connection && mongoose.connection.readyState === 1;
  } catch (e) { return false; }
}

router.post('/watch-ad', async (req, res) => {
  try {
    const { firebaseUid, amount = 10 } = req.body;
    // Prefer Mongoose user update when available
    if (isMongooseReady()) {
      const user = await User.findOne({ firebaseUid });
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.isBanned) return res.status(403).json({ error: 'User is banned' });
      user.wallet += amount;
      await user.save();

      await Earning.create({ userId: user._id, firebaseUid, amount, type: 'ad_watch', description: 'Watched ad' });
      await Message.create({ userId: user._id, firebaseUid, message: `You earned ₦${amount} for watching an ad`, type: 'earning' });

      return res.json({ success: true, newWallet: user.wallet });
    }

    // fallback to file-based flow
    const userRecordPath = path.join(DATA_DIR, 'users.json');
    let users = [];
    try { users = JSON.parse(fs.readFileSync(userRecordPath, 'utf8') || '[]'); } catch (e) { users = []; }
    let user = users.find(u => (u.firebaseUid || u.uid || '').toString() === (firebaseUid || '').toString());
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.wallet = (user.wallet || 0) + amount;
    // write user
    fs.writeFileSync(userRecordPath, JSON.stringify(users, null, 2));

    // transactions/messages file
    const transactions = readJson('transactions.json');
    transactions.push({ id: Date.now().toString(), userId: user.id || user.uid, firebaseUid, amount, type: 'ad', date: new Date().toISOString() });
    writeJson('transactions.json', transactions);

    const messages = readJson('messages.json');
    messages.push({ id: Date.now().toString(), userId: user.id || user.uid, firebaseUid, message: `You earned ₦${amount} for watching an ad`, type: 'earning', createdAt: new Date().toISOString() });
    writeJson('messages.json', messages);

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

// Admin login (accept frontend {email,password})
router.post('/login', (req, res) => {
  const body = req.body || {};
  const email = (body.email || body.username || '').toString().trim();
  const password = (body.password || body.pass || '').toString();
  if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

  const allowedEmails = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '').toString().split(',').map(s=>s.trim()).filter(Boolean);
  const allowedPass = process.env.ADMIN_PASSWORD || process.env.ADMIN_PASS || process.env.ADMIN_PASSWD || '';
  const matched = allowedEmails.includes(email) || (allowedEmails.length === 1 && allowedEmails[0] === email);
  if (matched && allowedPass && password === allowedPass) return res.json({ ok: true, token: 'admin-local-token' });

  if ((process.env.ADMIN_USER === email || process.env.ADMIN_USER === undefined) && (process.env.ADMIN_PASS && password === process.env.ADMIN_PASS)) {
    return res.json({ ok: true, token: 'admin-local-token' });
  }

  return res.status(403).json({ error: 'Invalid credentials' });
});

// List users (prefer DB)
router.get('/users', async (req, res) => {
  try {
    let users = [];
    if (isMongooseReady()) {
      users = await User.find({}).limit(1000).lean();
    } else {
      users = readDataFile('users.json', []);
    }

    const total = (users || []).length;
    const banned = (users || []).filter(u => u.isBanned || u.status === 'banned').length;
    const bots = 0; // heuristic not implemented; leave 0
    const real = total - banned - bots;

    // counts for today/week/month
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const parseCreated = (u) => new Date(u.createdAt || u.createdAtAt || u.created || u.created_at || u._id?.getTimestamp?.() || u.createdAt);

    const today = (users || []).filter(u => { const d = parseCreated(u); return d && d >= startOfDay; }).length;
    const week = (users || []).filter(u => { const d = parseCreated(u); return d && d >= startOfWeek; }).length;
    const month = (users || []).filter(u => { const d = parseCreated(u); return d && d >= startOfMonth; }).length;

    return res.json({ users, total, banned, bots, real, healthScore: total ? Math.round(((real) / total) * 100) : 0, today, week, month });
  } catch (e) { res.status(500).json({ error: 'Failed to read users' }); }
});

// Messages
router.get('/messages', async (req, res) => {
  try {
    if (isMongooseReady()) {
      const messages = await Message.find({}).sort({ createdAt: -1 }).limit(200).lean();
      return res.json(messages);
    }
    const messages = readDataFile('messages.json', []);
    res.json(messages);
  } catch (e) { res.status(500).json({ error: 'Failed to read messages' }); }
});

router.post('/reply-message/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    if (isMongooseReady()) {
      const msg = await Message.findById(id);
      if (!msg) return res.status(404).json({ error: 'Message not found' });
      msg.replies = msg.replies || [];
      msg.replies.push({ reply: body.reply || '', by: body.by || 'admin', date: new Date() });
      await msg.save();
      return res.json({ ok: true, message: msg });
    }

    const messages = readDataFile('messages.json', []);
    const msg = messages.find(m => String(m.id) === String(id));
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    msg.replies = msg.replies || [];
    msg.replies.push({ reply: body.reply || '', by: body.by || 'admin', date: new Date().toISOString() });
    writeDataFile('messages.json', messages);
    res.json({ ok: true, message: msg });
  } catch (e) { res.status(500).json({ error: 'Failed to reply' }); }
});

// Withdrawals (admin list)
router.get('/withdrawals', async (req, res) => {
  try {
    // If using native mongo or mongoose, you may have withdrawals in a collection; fallback to file
    const data = readDataFile('withdrawals.json', []);
    res.json(data);
  } catch (e) { res.status(500).json({ error: 'Failed to read withdrawals' }); }
});

// History / transactions
router.get('/history', async (req, res) => {
  try {
    if (isMongooseReady()) {
      const tx = await Earning.find({}).sort({ createdAt: -1 }).limit(1000).lean();
      return res.json(tx);
    }
    const tx = readDataFile('transactions.json', []);
    res.json(tx);
  } catch (e) { res.status(500).json({ error: 'Failed to read history' }); }
});

// Dashboard summary
router.get('/dashboard', async (req, res) => {
  try {
    if (isMongooseReady()) {
      const totalUsers = await User.countDocuments();
      const totalTransactions = await Earning.countDocuments();
      const agg = await Earning.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]);
      const totalEarnedUsd = (agg[0] && agg[0].total) || 0;
      return res.json({ totalUsers, totalTransactions, totalEarnedUsd });
    }
    const users = readDataFile('users.json', []);
    const tx = readDataFile('transactions.json', []);
    const totalUsers = users.length;
    const totalTransactions = tx.length;
    const totalEarnedUsd = tx.reduce((s,t)=>s + Number(t.amountUsd || 0), 0);
    res.json({ totalUsers, totalTransactions, totalEarnedUsd });
  } catch (e) { res.status(500).json({ error: 'Failed to compute dashboard' }); }
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
router.get('/leaderboard', async (req, res) => {
  try {
    if (isMongooseReady()) {
      const top = await User.find({}).sort({ wallet: -1 }).limit(50).lean();
      return res.json(top);
    }
    const users = readDataFile('users.json', []);
    const top = users.sort((a,b)=> (b.wallet || 0) - (a.wallet || 0)).slice(0,50);
    res.json(top);
  } catch (e) { res.status(500).json({ error: 'Failed to read leaderboard' }); }
});

// Simple chart data endpoints (mocked from transactions)
router.get('/chart/earnings', async (req, res) => {
  try {
    let tx = [];
    if (isMongooseReady()) tx = await Earning.find({}).lean(); else tx = readDataFile('transactions.json', []);
    const now = Date.now();
    const days = Array.from({length:7}).map((_,i)=>{
      const date = new Date(now - (6-i)*24*60*60*1000);
      const key = date.toISOString().slice(0,10);
      const total = tx.filter(t=> (t.date||t.createdAt||'').toString().slice(0,10)===key).reduce((s,t)=>s+Number(t.amountUsd||t.amount||0),0);
      return { date: key, total };
    });
    res.json(days);
  } catch (e) { res.status(500).json({ error: 'Failed to build chart' }); }
});

router.get('/chart/ads-watched', async (req, res) => {
  try {
    let tx = [];
    if (isMongooseReady()) tx = await Earning.find({ type: /ad/i }).lean(); else tx = readDataFile('transactions.json', []);
    const count = Array.isArray(tx) ? tx.length : 0;
    res.json({ adsWatched: count });
  } catch (e) { res.status(500).json({ error: 'Failed to build ads chart' }); }
});

router.get('/chart/earnings-summary', async (req, res) => {
  try {
    if (isMongooseReady()) {
      const agg = await Earning.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]);
      return res.json({ totalUsd: (agg[0] && agg[0].total) || 0 });
    }
    const tx = readDataFile('transactions.json', []);
    const summary = tx.reduce((acc,t)=>{ acc.totalUsd += Number(t.amountUsd||0); return acc; }, { totalUsd:0 });
    res.json(summary);
  } catch (e) { res.status(500).json({ error: 'Failed to build earnings summary' }); }
});

// Update user actions: ban/promote/admin
router.put('/users/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const action = (body.action || body.actionType || '').toString();

    // Prefer mongoose when available
    if (isMongooseReady()) {
      // support _id, id, uid
      let user = await User.findOne({ $or: [{ _id: id }, { id: id }, { uid: id }, { firebaseUid: id }] });
      if (!user) return res.status(404).json({ error: 'User not found' });

      if (action === 'banned' || action === 'ban') {
        user.isBanned = true;
        await user.save();
        return res.json({ ok: true });
      }

      if (action === 'promote' || action === 'verified' || action === 'promoted') {
        // generate 4-digit code and store it on user, send email when SMTP configured
        const code = Math.floor(1000 + Math.random() * 9000).toString();
        user.promoted = false;
        user.promoteCode = code;
        user.promoteRequestedAt = new Date();
        user.promoteExpires = new Date(Date.now() + 24 * 3600 * 1000);
        await user.save();

        await recordPromotionLog({
          userId: user._id ? String(user._id) : user.uid || user.id || user.firebaseUid || null,
          email: user.email || null,
          code,
          status: 'pending',
          method: 'email',
          adminEmail: req.user && req.user.email ? req.user.email : null
        });

        // send email if SMTP configured
        const SMTP_HOST = process.env.SMTP_HOST;
        const SMTP_USER = process.env.SMTP_USER;
        const SMTP_PASS = process.env.SMTP_PASS;
        const FROM_EMAIL = process.env.FROM_EMAIL || 'watch2earn36@gmail.com';
        if (nodemailer && SMTP_HOST && SMTP_USER && SMTP_PASS) {
          try {
            const transporter = nodemailer.createTransport({ host: SMTP_HOST, port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587, secure: !!process.env.SMTP_SECURE, auth: { user: SMTP_USER, pass: SMTP_PASS } });
            await transporter.sendMail({ from: FROM_EMAIL, to: user.email, subject: 'Your Watch2Earn verification code', text: `Your verification code is: ${code}` });
            await recordPromotionLog({
              userId: user._id ? String(user._id) : user.uid || user.id || user.firebaseUid || null,
              email: user.email || null,
              code,
              status: 'email_sent',
              method: 'email',
              adminEmail: req.user && req.user.email ? req.user.email : null
            });
            return res.json({ ok: true, message: 'Code generated and emailed' });
          } catch (e) {
            console.error('Failed to send promo email:', e && e.message);
            await recordPromotionLog({
              userId: user._id ? String(user._id) : user.uid || user.id || user.firebaseUid || null,
              email: user.email || null,
              code,
              status: 'email_failed',
              method: 'email',
              adminEmail: req.user && req.user.email ? req.user.email : null
            });
            user.promoted = true;
            user.promotedAt = new Date();
            user.promoteCode = null;
            user.promoteExpires = null;
            await user.save();
            return res.json({ ok: true, message: 'No SMTP configured — user auto-promoted' });
          }
        } else {
          // SMTP not configured — auto-promote as fallback
          user.promoted = true;
          user.promotedAt = new Date();
          user.promoteCode = null;
          user.promoteExpires = null;
          await user.save();
          await recordPromotionLog({
            userId: user._id ? String(user._id) : user.uid || user.id || user.firebaseUid || null,
            email: user.email || null,
            code,
            status: 'auto_promoted',
            method: 'fallback',
            adminEmail: req.user && req.user.email ? req.user.email : null
          });
          return res.json({ ok: true, message: 'No SMTP configured — user auto-promoted' });
        }
      }

      if (action === 'admin' || action === 'promote-admin') {
        user.role = 'admin';
        await user.save();
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    // Fallback to file storage
    const usersPath = path.join(DATA_DIR, 'users.json');
    let users = [];
    try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { users = []; }
    const u = users.find(x => String(x.id) === String(id) || String(x.uid) === String(id) || (x.email||'') === (id||''));
    if (!u) return res.status(404).json({ error: 'User not found' });

    if (action === 'banned' || action === 'ban') { u.isBanned = true; }
    else if (action === 'promote' || action === 'verified' || action === 'promoted') { u.promoted = true; u.promotedAt = new Date().toISOString(); }
    else if (action === 'admin' || action === 'promote-admin') { u.role = 'admin'; }
    else return res.status(400).json({ error: 'Unknown action' });

    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
    return res.json({ ok: true });
  } catch (e) { console.error('admin update user error', e); res.status(500).json({ error: 'Failed to update user' }); }
});

module.exports = router;
