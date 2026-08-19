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

function safeObjectId(value) {
  if (!value || value === 'undefined' || value === 'null') return null;
  const str = String(value).trim();
  if (!str) return null;
  return mongoose.Types.ObjectId.isValid(str) ? new mongoose.Types.ObjectId(str) : null;
}

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

function resolveUserFindQuery(id, email) {
  const cleanId = typeof id === 'string' ? id.trim() : id;
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : null;
  const conditions = [];

  const objectId = safeObjectId(cleanId);
  if (objectId) conditions.push({ _id: objectId });

  if (cleanId && cleanId !== 'undefined' && cleanId !== 'null') {
    conditions.push({ id: cleanId }, { uid: cleanId }, { firebaseUid: cleanId });
  }
  if (normalizedEmail) {
    conditions.push({ email: normalizedEmail });
  }
  return conditions.length ? { $or: conditions } : {};
}

async function findUserByAdminIdentifier(id, email) {
  const query = resolveUserFindQuery(id, email);
  if (!query || Object.keys(query).length === 0) return null;

  if (isMongooseReady()) {
    const user = await User.findOne(query);
    if (user) return user;
  }

  const usersPath = path.join(DATA_DIR, 'users.json');
  let users = [];
  try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { users = []; }
  const idValue = String(id || '').trim();
  const emailValue = String(email || '').trim().toLowerCase();
  return users.find(u => (
    (idValue && (String(u.id) === idValue || String(u.uid) === idValue || String(u.firebaseUid) === idValue)) ||
    (emailValue && (String(u.email || '').toLowerCase() === emailValue))
  )) || null;
}

router.get('/inbox', async (req, res) => {
  try {
    const inboxMessages = readJson(MESSAGES_PATH).filter(Boolean);
    const users = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8') || '[]'); } catch { return []; } })();
    const withdrawals = (() => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'withdrawals.json'), 'utf8') || '[]'); } catch { return []; } })();

    const help = inboxMessages.filter(m => m.type === 'help' || m.type === 'system' || m.type === 'user_message' || !m.type);
    const alerts = inboxMessages.filter(m => m.type === 'alert' || m.type === 'warning');
    const response = {
      help,
      alerts,
      withdrawals,
      recentSignups: users.slice(0, 8).map(u => ({ id: u.id || u.uid || u.firebaseUid, name: u.displayName || u.username || (u.email || '').split('@')[0], email: u.email }))
    };
    return res.json(response);
  } catch (error) {
    console.error('Inbox error:', error);
    return res.status(500).json({ error: 'Failed to load inbox' });
  }
});

router.post('/reply-message/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {}; 
    const items = readJson(MESSAGES_PATH);
    const match = items.find(m => String(m.id) === String(id));
    if (!match) return res.status(404).json({ error: 'Message not found' });
    match.replies = match.replies || [];
    match.replies.push({
      reply: body.reply || '',
      by: 'admin',
      date: new Date().toISOString()
    });
    fs.writeFileSync(MESSAGES_PATH, JSON.stringify(items, null, 2));
    return res.json({ ok: true, message: match });
  } catch (error) {
    console.error('Reply-message error:', error);
    return res.status(500).json({ error: 'Failed to reply' });
  }
});

router.post('/watch-ad', async (req, res) => {
  try {
    const { firebaseUid, amount = 10 } = req.body;
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

    const userRecordPath = path.join(DATA_DIR, 'users.json');
    let users = [];
    try { users = JSON.parse(fs.readFileSync(userRecordPath, 'utf8') || '[]'); } catch (e) { users = []; }
    let user = users.find(u => (u.firebaseUid || u.uid || '').toString() === (firebaseUid || '').toString());
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.wallet = (user.wallet || 0) + amount;
    fs.writeFileSync(userRecordPath, JSON.stringify(users, null, 2));

    const transactions = readJson(TRANSACTIONS_PATH);
    transactions.push({ id: Date.now().toString(), userId: user.id || user.uid, firebaseUid, amount, type: 'ad', date: new Date().toISOString() });
    writeJson(TRANSACTIONS_PATH, transactions);

    const messages = readJson(MESSAGES_PATH);
    messages.push({ id: Date.now().toString(), userId: user.id || user.uid, firebaseUid, message: `You earned ₦${amount} for watching an ad`, type: 'earning', createdAt: new Date().toISOString() });
    writeJson(MESSAGES_PATH, messages);
    res.json({ success: true, newWallet: user.wallet });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/login', (req, res) => {
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

router.get('/users', async (req, res) => {
  try {
    let users = [];
    if (isMongooseReady()) {
      users = await User.find({}).limit(1000).lean();
    } else {
      users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8') || '[]');
    }

    const total = (users || []).length;
    const banned = (users || []).filter(u => u.isBanned || u.status === 'banned').length;
    const real = total - banned;

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const parseCreated = (u) => new Date(u.createdAt || u.createdAtAt || u.created || u.created_at || u._id?.getTimestamp?.() || Date.now());
    const today = (users || []).filter(u => { const d = parseCreated(u); return d && d >= startOfDay; }).length;
    const week = (users || []).filter(u => { const d = parseCreated(u); return d && d >= startOfWeek; }).length;
    const month = (users || []).filter(u => { const d = parseCreated(u); return d && d >= startOfMonth; }).length;

    return res.json({ users, total, banned, bots: 0, real, healthScore: total ? Math.round((real / total) * 100) : 0, today, week, month });
  } catch (e) { res.status(500).json({ error: 'Failed to read users' }); }
});

router.get('/messages', async (req, res) => {
  try {
    if (isMongooseReady()) {
      const messages = await Message.find({}).sort({ createdAt: -1 }).limit(200).lean();
      return res.json(messages);
    }
    const messages = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'messages.json'), 'utf8') || '[]');
    res.json(messages);
  } catch (e) { res.status(500).json({ error: 'Failed to read messages' }); }
});

router.get('/withdrawals', async (req, res) => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'withdrawals.json'), 'utf8') || '[]');
    res.json(data);
  } catch (e) { res.status(500).json({ error: 'Failed to read withdrawals' }); }
});

router.get('/history', async (req, res) => {
  try {
    if (isMongooseReady()) {
      const tx = await Earning.find({}).sort({ createdAt: -1 }).limit(1000).lean();
      return res.json(tx);
    }
    const tx = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'transactions.json'), 'utf8') || '[]');
    res.json(tx);
  } catch (e) { res.status(500).json({ error: 'Failed to read history' }); }
});

router.get('/dashboard', async (req, res) => {
  try {
    if (isMongooseReady()) {
      const totalUsers = await User.countDocuments();
      const totalTransactions = await Earning.countDocuments();
      const agg = await Earning.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]);
      const totalEarnedUsd = (agg[0] && agg[0].total) || 0;
      return res.json({ totalUsers, totalTransactions, totalEarnedUsd });
    }
    const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8') || '[]');
    const tx = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'transactions.json'), 'utf8') || '[]');
    const totalUsers = users.length;
    const totalTransactions = tx.length;
    const totalEarnedUsd = tx.reduce((s,t)=>s + Number(t.amountUsd || 0), 0);
    res.json({ totalUsers, totalTransactions, totalEarnedUsd });
  } catch (e) { res.status(500).json({ error: 'Failed to compute dashboard' }); }
});

router.get('/bonuses', (req, res) => {
  try {
    const bonuses = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bonuses.json'), 'utf8') || '[]');
    res.json(bonuses);
  } catch (e) { res.status(500).json({ error: 'Failed to read bonuses' }); }
});

router.post('/send-bonus', (req, res) => {
  try {
    const b = req.body || {};
    const bonuses = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bonuses.json'), 'utf8') || '[]');
    const entry = { id: Date.now().toString(), ...b, createdAt: new Date().toISOString(), claimed: false };
    bonuses.unshift(entry);
    fs.writeFileSync(path.join(DATA_DIR, 'bonuses.json'), JSON.stringify(bonuses, null, 2));
    res.json({ ok: true, bonus: entry, count: 1 });
  } catch (e) { res.status(500).json({ error: 'Failed to send bonus' }); }
});

router.put('/users/:id', async (req, res) => {
  try {
    const id = req.params && req.params.id;
    const body = req.body || {};
    const action = (body.action || body.actionType || '').toString();
    const userEmail = body.email || null;

    const user = await findUserByAdminIdentifier(id, userEmail);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (action === 'banned' || action === 'ban') {
      if (isMongooseReady()) {
        user.isBanned = true;
        await user.save();
      } else {
        user.isBanned = true;
        const usersPath = path.join(DATA_DIR, 'users.json');
        let users = []; try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { users = []; }
        const idx = users.findIndex(u => String(u.id) === String(user.id || user.uid || user.firebaseUid) || String(u.uid) === String(user.uid || user.id || user.firebaseUid) || (u.email || '').toLowerCase() === String(user.email || '').toLowerCase());
        if (idx >= 0) { users[idx] = { ...users[idx], isBanned: true }; fs.writeFileSync(usersPath, JSON.stringify(users, null, 2)); }
      }
      return res.json({ ok: true });
    }

    if (action === 'promote' || action === 'verified' || action === 'promoted') {
      const code = Math.floor(1000 + Math.random() * 9000).toString();
      if (isMongooseReady()) {
        user.promoted = false;
        user.promoteCode = code;
        user.promoteRequestedAt = new Date();
        user.promoteExpires = new Date(Date.now() + 24 * 3600 * 1000);
        await user.save();
      } else {
        const usersPath = path.join(DATA_DIR, 'users.json');
        let users = []; try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { users = []; }
        const idx = users.findIndex(u => String(u.id) === String(user.id || user.uid || user.firebaseUid) || String(u.uid) === String(user.uid || user.id || user.firebaseUid) || (u.email || '').toLowerCase() === String(user.email || '').toLowerCase());
        if (idx >= 0) {
          users[idx].promoted = false; users[idx].promoteCode = code; users[idx].promoteRequestedAt = new Date().toISOString(); users[idx].promoteExpires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
        } else {
          user.promoteCode = code; user.promoted = false; user.promoteExpires = new Date(Date.now() + 24 * 3600 * 1000).toISOString(); users.push(user);
        }
        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
      }

      await recordPromotionLog({
        userId: user._id ? String(user._id) : user.uid || user.id || user.firebaseUid || null,
        email: user.email || null,
        code,
        status: 'pending',
        method: 'email',
        adminEmail: req.user && req.user.email ? req.user.email : null
      });

      const SMTP_HOST = process.env.SMTP_HOST || process.env.SMPT_HOST;
      const SMTP_USER = process.env.SMTP_USER || process.env.SMPT_USER;
      const SMTP_PASS = process.env.SMTP_PASS || process.env.SMPT_PASS;
      const SMTP_PORT = process.env.SMTP_PORT || process.env.SMPT_PORT || '587';
      const SMTP_SECURE = (process.env.SMTP_SECURE || process.env.SMPT_SECURE || 'false').toString().toLowerCase() === 'true';
      const FROM_EMAIL = process.env.FROM_EMAIL || process.env.SMTP_FROM || 'watch2earn@gmail.com';
      if (nodemailer && SMTP_HOST && SMTP_USER && SMTP_PASS) {
        try {
          const transporter = nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT) || 587, secure: SMTP_SECURE, auth: { user: SMTP_USER, pass: SMTP_PASS } });
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
          if (isMongooseReady()) {
            user.promoted = true;
            user.promotedAt = new Date();
            user.promoteCode = null;
            user.promoteExpires = null;
            await user.save();
          }
          await recordPromotionLog({
            userId: user._id ? String(user._id) : user.uid || user.id || user.firebaseUid || null,
            email: user.email || null,
            code,
            status: 'auto_promoted',
            method: 'fallback',
            adminEmail: req.user && req.user.email ? req.user.email : null
          });
          return res.json({ ok: true, message: 'SMTP failed — user auto-promoted' });
        }
      }

      if (isMongooseReady()) {
        user.promoted = true;
        user.promotedAt = new Date();
        user.promoteCode = null;
        user.promoteExpires = null;
        await user.save();
      }
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

    if (action === 'admin' || action === 'promote-admin') {
      if (isMongooseReady()) {
        user.role = 'admin';
        await user.save();
      } else {
        const usersPath = path.join(DATA_DIR, 'users.json');
        let users = []; try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { users = []; }
        const idx = users.findIndex(u => String(u.id) === String(user.id || user.uid || user.firebaseUid) || String(u.uid) === String(user.uid || user.id || user.firebaseUid) || (u.email || '').toLowerCase() === String(user.email || '').toLowerCase());
        if (idx >= 0) { users[idx].role = 'admin'; fs.writeFileSync(usersPath, JSON.stringify(users, null, 2)); }
      }
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (e) { console.error('admin update user error', e); res.status(500).json({ error: 'Failed to update user' }); }
});

module.exports = router;
