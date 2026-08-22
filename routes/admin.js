const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Earning = require('../models/earning');
const Message = require('../models/messeges');
const fs = require('fs');
const path = require('path');
const mongoNative = require('../mongodb');
const { auth: firebaseAdminAuth } = require('../config/firebaseAdmin');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRANSACTIONS_PATH = path.join(DATA_DIR, 'transactions.json');
const MESSAGES_PATH = path.join(DATA_DIR, 'messages.json');
const PROMOTIONS_PATH = path.join(DATA_DIR, 'promotions.json');
const TRIGGERS_PATH = path.join(DATA_DIR, 'triggers.json');
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

function buildAdminEmailTransport() {
  if (!nodemailer) return null;

  const SMTP_HOST = process.env.SMTP_HOST || process.env.SMPT_HOST || 'smtp.gmail.com';
  const SMTP_USER = process.env.SMTP_USER || process.env.SMPT_USER || 'watch2earn36@gmail.com';
  const SMTP_PASS = process.env.SMTP_PASS || process.env.SMPT_PASS || process.env.GMAIL_APP_PASSWORD || '';
  const SMTP_PORT = Number(process.env.SMTP_PORT || process.env.SMPT_PORT || 587);
  const SMTP_SECURE = String(process.env.SMTP_SECURE || process.env.SMPT_SECURE || 'false').toLowerCase() === 'true';

  if (!SMTP_PASS) return null;

  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
}

async function forwardInboxEmail({ from, subject, text, html }) {
  const transporter = buildAdminEmailTransport();
  if (!transporter) return null;

  const adminEmail = process.env.ADMIN_EMAIL || process.env.FROM_EMAIL || process.env.SMTP_FROM || 'watch2earn36@gmail.com';
  try {
    return await transporter.sendMail({
      from: adminEmail,
      to: adminEmail,
      replyTo: from || adminEmail,
      subject: subject || 'Watch2Earn inbox message',
      text: text || (typeof html === 'string' ? html.replace(/<[^>]+>/g, ' ') : ''),
      html: html || `<p>${(text || '').replace(/\n/g, '<br>')}</p>`
    });
  } catch (e) {
    console.warn('Inbox email forward failed:', e && e.message);
    return null;
  }
}

async function readUserRecords() {
  if (isMongooseReady()) {
    return await User.find({}).lean();
  }

  const usersPath = path.join(DATA_DIR, 'users.json');
  try { return JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { return []; }
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

// Create a new admin message (save and optionally send immediately)
router.post('/messages', async (req, res) => {
  try {
    const body = req.body || {};
    const items = readJson(MESSAGES_PATH);
    const id = Date.now().toString() + '-' + Math.random().toString(36).slice(2,8);
    const entry = {
      id,
      title: body.title || body.template || (body.templateType ? (body.templateType + ' message') : 'Admin message'),
      message: body.message || body.template || '',
      templateType: body.templateType || 'template',
      targetType: body.targetType || 'all',
      targetUsers: body.targetUsers || [],
      sendType: body.sendType || 'manual',
      scheduleDateTime: body.scheduleDateTime || null,
      frequency: body.frequency || 'once',
      priority: body.priority || 'normal',
      status: body.status || (body.sendType === 'automatic' ? 'scheduled' : 'sent'),
      createdAt: new Date().toISOString(),
      from: process.env.FROM_EMAIL || process.env.SMTP_USER || 'watch2earn36@gmail.com'
    };

    items.unshift(entry);
    writeJson(MESSAGES_PATH, items.slice(0, 500));

    // If sendType is manual/pending, try to send email now to all users (or targeted users)
    if (entry.sendType === 'manual' || entry.status === 'sent') {
      try {
        const transporter = buildAdminEmailTransport();
        if (transporter) {
          // For safety, send only to FROM (admin) or to specific user list if provided
          const recipients = Array.isArray(entry.targetUsers) && entry.targetUsers.length ? entry.targetUsers.map(u=>u.email||u) : (entry.targetType === 'all' ? (process.env.FROM_EMAIL || process.env.SMTP_USER) : []);
          await transporter.sendMail({
            from: entry.from,
            to: recipients.length ? recipients.join(',') : (process.env.FROM_EMAIL || process.env.SMTP_USER),
            subject: entry.title,
            text: entry.message,
            html: `<pre>${(entry.message || '').replace(/</g,'&lt;')}</pre>`
          });
        }
      } catch (e) { console.warn('Admin message email send failed:', e && e.message); }
    }

    return res.json({ ok: true, message: entry });
  } catch (e) {
    console.error('Create message error:', e);
    return res.status(500).json({ error: 'Failed to create message' });
  }
});

// Delete admin message
router.delete('/messages/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const items = readJson(MESSAGES_PATH).filter(Boolean).filter(m => String(m.id) !== String(id));
    writeJson(MESSAGES_PATH, items);
    return res.json({ ok: true });
  } catch (e) { console.error('Delete message error:', e); return res.status(500).json({ error: 'Failed to delete message' }); }
});

// Incoming email webhook - save incoming email to messages.json
router.post('/incoming-email', express.json(), async (req, res) => {
  try {
    const { from, subject, text, html } = req.body || {};
    const items = readJson(MESSAGES_PATH);
    const entry = { id: Date.now().toString(), from: from || 'unknown', title: subject || 'Email', message: text || (html || ''), type: 'email', createdAt: new Date().toISOString() };
    items.unshift(entry);
    writeJson(MESSAGES_PATH, items.slice(0, 500));
    // Optionally forward into SMTP inbox
    await forwardInboxEmail({ from, subject, text, html });
    return res.json({ ok: true, entry });
  } catch (e) { console.error('Incoming email error:', e); return res.status(500).json({ error: 'Failed to process incoming email' }); }
});

// Appeals: users submit appeals when suspended
const APPEALS_PATH = path.join(DATA_DIR, 'appeals.json');
function readAppeals() { try { if (!fs.existsSync(APPEALS_PATH)) fs.writeFileSync(APPEALS_PATH, '[]'); return JSON.parse(fs.readFileSync(APPEALS_PATH,'utf8')||'[]'); } catch(e){ return []; } }
function writeAppeals(arr){ fs.writeFileSync(APPEALS_PATH, JSON.stringify(arr, null, 2)); }

router.post('/appeals', async (req, res) => {
  try {
    const body = req.body || {};
    const appeals = readAppeals();
    const id = Date.now().toString() + '-' + Math.random().toString(36).slice(2,6);
    const entry = { id, userId: body.userId || null, email: body.email || null, description: body.description || '', status: 'under_review', createdAt: new Date().toISOString() };
    appeals.unshift(entry);
    writeAppeals(appeals);
    // Also add to messages.json so admin sees it in inbox
    const messages = readJson(MESSAGES_PATH);
    messages.unshift({ id: 'appeal-' + id, userId: entry.userId, message: entry.description, type: 'appeal', createdAt: entry.createdAt });
    writeJson(MESSAGES_PATH, messages);
    return res.json({ ok: true, appeal: entry });
  } catch (e) { console.error('Appeal error:', e); return res.status(500).json({ error: 'Failed to submit appeal' }); }
});

router.get('/appeals', async (req, res) => { try { return res.json(readAppeals()); } catch (e) { return res.status(500).json({ error: 'Failed to read appeals' }); } });

router.put('/appeals/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const appeals = readAppeals();
    const idx = appeals.findIndex(a => String(a.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: 'Appeal not found' });
    appeals[idx] = { ...appeals[idx], ...body, updatedAt: new Date().toISOString() };
    writeAppeals(appeals);
    return res.json({ ok: true, appeal: appeals[idx] });
  } catch (e) { console.error('Update appeal error:', e); return res.status(500).json({ error: 'Failed to update appeal' }); }
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

router.post('/send-bonus', async (req, res) => {
  try {
    const b = req.body || {};
    const amountUsd = Number(b.amountUsd ?? b.amount ?? 0);
    const targetType = String(b.targetType || 'all').trim() || 'all';
    const targetUserId = b.targetUserId || b.userId || null;

    if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
      return res.status(400).json({ error: 'Valid bonus amount is required' });
    }

    if (targetType === 'specific' && (!targetUserId || String(targetUserId).trim() === '')) {
      return res.status(400).json({ error: 'A target user ID is required for specific bonuses' });
    }

    const entry = {
      id: Date.now().toString() + '-' + Math.random().toString(36).slice(2, 8),
      title: b.title || 'Admin bonus',
      description: b.description || 'You received a bonus from the admin team.',
      amountUsd,
      targetType,
      targetUserId: targetType === 'specific' ? String(targetUserId).trim() : null,
      targetUsers: Array.isArray(b.targetUsers) ? b.targetUsers : [],
      createdAt: new Date().toISOString(),
      claimed: false,
      status: 'pending'
    };

    const bonusesPath = path.join(DATA_DIR, 'bonuses.json');
    const bonuses = JSON.parse(fs.readFileSync(bonusesPath, 'utf8') || '[]');
    bonuses.unshift(entry);
    fs.writeFileSync(bonusesPath, JSON.stringify(bonuses, null, 2));

    try {
      if (mongoNative && typeof mongoNative.getCollection === 'function') {
        const bonusCol = mongoNative.getCollection('bonuses');
        await bonusCol.insertOne(entry);
      }
    } catch (e) {
      console.warn('Admin bonus Mongo sync skipped:', e && e.message);
    }

    res.json({ ok: true, bonus: entry, count: targetType === 'specific' ? 1 : 'all' });
  } catch (e) {
    console.error('Failed to send bonus:', e);
    res.status(500).json({ error: 'Failed to send bonus' });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const id = req.params && req.params.id;
    const body = req.body || {};
    const action = (body.action || body.actionType || '').toString();
    const userEmail = body.email || null;

    // Validate that we have at least an id or email
    if (( !id || id === 'undefined' || id === 'null' ) && ( !userEmail || userEmail === 'undefined' || userEmail === 'null' )) {
      return res.status(400).json({ error: 'User ID or email is required' });
    }

    const user = await findUserByAdminIdentifier(id, userEmail);
    if (!user) {
      // Log failed admin lookup for debugging promote/cast errors
      try {
        const errLogPath = path.join(DATA_DIR, 'promote_errors.json');
        let errs = [];
        try { errs = JSON.parse(fs.readFileSync(errLogPath, 'utf8') || '[]'); } catch (e) { errs = []; }
        errs.unshift({ id: id || null, body: body || null, ip: req.ip || null, time: new Date().toISOString() });
        fs.writeFileSync(errLogPath, JSON.stringify(errs.slice(0, 200), null, 2));
      } catch (e) { console.warn('Failed to write promote_errors log', e && e.message); }
      console.warn('Admin user lookup failed for:', { id, body });
      return res.status(404).json({ error: 'User not found' });
    }

    if (action === 'banned' || action === 'ban') {
      if (isMongooseReady()) {
        user.isBanned = true;
        user.isSuspended = false;
        user.status = 'banned';
        user.banReason = body.reason || 'Violation of platform rules';
        await user.save();
        // Disable Firebase auth account for a hard ban (if possible)
        try {
          if (firebaseAdminAuth && user.firebaseUid && !String(user.firebaseUid).startsWith('guest:')) {
            await firebaseAdminAuth.updateUser(user.firebaseUid, { disabled: true });
          }
        } catch (e) { console.warn('Firebase disable failed:', e && e.message); }
      } else {
        user.isBanned = true;
        user.isSuspended = false;
        user.status = 'banned';
        const usersPath = path.join(DATA_DIR, 'users.json');
        let users = []; try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { users = []; }
        const idx = users.findIndex(u => String(u.id) === String(user.id || user.uid || user.firebaseUid) || String(u.uid) === String(user.uid || user.id || user.firebaseUid) || (u.email || '').toLowerCase() === String(user.email || '').toLowerCase());
        if (idx >= 0) { users[idx] = { ...users[idx], isBanned: true, isSuspended: false, status: 'banned', banReason: body.reason || 'Violation of platform rules' }; fs.writeFileSync(usersPath, JSON.stringify(users, null, 2)); }
      }
      return res.json({ ok: true, status: 'banned' });
    }

    if (action === 'suspend' || action === 'suspended') {
      if (isMongooseReady()) {
        user.isSuspended = true;
        user.isBanned = false;
        user.status = 'suspended';
        user.suspendReason = body.reason || 'Suspended pending review';
        await user.save();
      } else {
        user.isSuspended = true;
        user.isBanned = false;
        user.status = 'suspended';
        const usersPath = path.join(DATA_DIR, 'users.json');
        let users = []; try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { users = []; }
        const idx = users.findIndex(u => String(u.id) === String(user.id || user.uid || user.firebaseUid) || String(u.uid) === String(user.uid || user.id || user.firebaseUid) || (u.email || '').toLowerCase() === String(user.email || '').toLowerCase());
        if (idx >= 0) { users[idx] = { ...users[idx], isSuspended: true, isBanned: false, status: 'suspended', suspendReason: body.reason || 'Suspended pending review' }; fs.writeFileSync(usersPath, JSON.stringify(users, null, 2)); }
      }
      return res.json({ ok: true, status: 'suspended' });
    }

    if (action === 'unban' || action === 'remove-ban' || action === 'allow') {
      if (isMongooseReady()) {
        user.isBanned = false;
        user.status = 'active';
        user.banReason = null;
        await user.save();
        // Re-enable Firebase auth account when unbanning
        try {
          if (firebaseAdminAuth && user.firebaseUid && !String(user.firebaseUid).startsWith('guest:')) {
            await firebaseAdminAuth.updateUser(user.firebaseUid, { disabled: false });
          }
        } catch (e) { console.warn('Firebase re-enable failed:', e && e.message); }
      } else {
        user.isBanned = false;
        user.status = 'active';
        const usersPath = path.join(DATA_DIR, 'users.json');
        let users = []; try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { users = []; }
        const idx = users.findIndex(u => String(u.id) === String(user.id || user.uid || user.firebaseUid) || String(u.uid) === String(user.uid || user.id || user.firebaseUid) || (u.email || '').toLowerCase() === String(user.email || '').toLowerCase());
        if (idx >= 0) { users[idx] = { ...users[idx], isBanned: false, status: 'active', banReason: null }; fs.writeFileSync(usersPath, JSON.stringify(users, null, 2)); }
      }
      return res.json({ ok: true, status: 'active' });
    }

    if (action === 'unsuspend' || action === 'remove-suspend') {
      if (isMongooseReady()) {
        user.isSuspended = false;
        user.status = 'active';
        user.suspendReason = null;
        await user.save();
      } else {
        user.isSuspended = false;
        user.status = 'active';
        const usersPath = path.join(DATA_DIR, 'users.json');
        let users = []; try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { users = []; }
        const idx = users.findIndex(u => String(u.id) === String(user.id || user.uid || user.firebaseUid) || String(u.uid) === String(user.uid || user.id || user.firebaseUid) || (u.email || '').toLowerCase() === String(user.email || '').toLowerCase());
        if (idx >= 0) { users[idx] = { ...users[idx], isSuspended: false, status: 'active', suspendReason: null }; fs.writeFileSync(usersPath, JSON.stringify(users, null, 2)); }
      }
      return res.json({ ok: true, status: 'active' });
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

// ===== TRIGGER MANAGEMENT =====
function readTriggers() {
  try {
    if (!fs.existsSync(TRIGGERS_PATH)) fs.writeFileSync(TRIGGERS_PATH, '[]');
    return JSON.parse(fs.readFileSync(TRIGGERS_PATH, 'utf8') || '[]');
  } catch (e) { return []; }
}

function writeTriggers(arr) {
  fs.writeFileSync(TRIGGERS_PATH, JSON.stringify(arr, null, 2));
}

// GET all triggers
router.get('/triggers', async (req, res) => {
  try {
    const triggers = readTriggers();
    return res.json(triggers);
  } catch (e) {
    return res.status(500).json({ error: 'Failed to load triggers' });
  }
});

// POST create trigger
router.post('/triggers', async (req, res) => {
  try {
    const { event, title, message, methods } = req.body || {};
    if (!event || !title || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const trigger = {
      id: Date.now().toString(),
      event,
      title,
      message,
      methods: methods || ['inbox'],
      createdAt: new Date().toISOString(),
      enabled: true
    };

    const triggers = readTriggers();
    triggers.unshift(trigger);
    writeTriggers(triggers);
    return res.json({ ok: true, trigger });
  } catch (e) {
    console.error('Trigger create error:', e);
    return res.status(500).json({ error: 'Failed to create trigger' });
  }
});

// DELETE trigger
router.delete('/triggers/:id', async (req, res) => {
  try {
    const triggerId = req.params.id;
    let triggers = readTriggers();
    triggers = triggers.filter(t => String(t.id) !== String(triggerId));
    writeTriggers(triggers);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to delete trigger' });
  }
});

// ===== PASSIVE USER TRACKING =====
// Identify passive users (no login for 7-30 days)
router.get('/passive-users', async (req, res) => {
  try {
    const days = req.query.days || 7;
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
      const passiveUsers = await User.find({
        $or: [
          { lastLogin: { $lt: cutoffDate } },
          { lastActivity: { $lt: cutoffDate } },
          { lastLogin: null, lastActivity: null, createdAt: { $lt: cutoffDate } }
        ],
        isBanned: false,
        isSuspended: false
      }).limit(500).lean();

      // Mark them as passive
      await User.updateMany(
        { _id: { $in: passiveUsers.map(u => u._id) } },
        { isPassive: true }
      );

      return res.json({
        count: passiveUsers.length,
        days,
        users: passiveUsers.slice(0, 50)
      });
    }

    return res.json({ count: 0, message: 'MongoDB not ready' });
  } catch (e) {
    console.error('Passive users error:', e);
    return res.status(500).json({ error: 'Failed to identify passive users' });
  }
});

// Mark user as passive or active
router.put('/passive-users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const { isPassive } = req.body || {};

    if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
      const user = await User.findOne({
        $or: [{ _id: userId }, { firebaseUid: userId }, { id: userId }]
      });
      if (!user) return res.status(404).json({ error: 'User not found' });

      user.isPassive = isPassive === true || isPassive === 'true';
      user.lastActivity = new Date();
      await user.save();
      return res.json({ ok: true });
    }

    return res.status(500).json({ error: 'MongoDB not ready' });
  } catch (e) {
    console.error('Update passive user error:', e);
    return res.status(500).json({ error: 'Failed to update' });
  }
});

// Diagnostics endpoint — shows Mongo status, activity collection counts, and SMTP config summary
router.get('/diagnostics', async (req, res) => {
  try {
    const mongoReady = isMongooseReady();
    let activityCount = null;
    let lastActivity = null;
    try {
      if (mongoNative && typeof mongoNative.getCollection === 'function') {
        const col = mongoNative.getCollection('user_activity');
        activityCount = await col.countDocuments();
        lastActivity = await col.find().sort({ timestamp: -1 }).limit(1).toArray();
        lastActivity = lastActivity && lastActivity[0] ? lastActivity[0] : null;
      } else {
        const logsPath = path.join(DATA_DIR, 'user_logs.json');
        if (fs.existsSync(logsPath)) {
          const arr = JSON.parse(fs.readFileSync(logsPath, 'utf8') || '[]');
          activityCount = arr.length;
          lastActivity = arr[0] || null;
        }
      }
    } catch (e) { console.warn('Diagnostics activity check failed:', e && e.message); }

    const smtp = {
      host: process.env.SMTP_HOST || process.env.SMPT_HOST || null,
      port: process.env.SMTP_PORT || process.env.SMPT_PORT || null,
      user: process.env.SMTP_USER || process.env.SMPT_USER || null,
      secure: (process.env.SMTP_SECURE || process.env.SMPT_SECURE || '').toString().toLowerCase() === 'true'
    };

    return res.json({ ok: true, mongoReady, activityCount, lastActivity, smtp });
  } catch (e) {
    console.error('Diagnostics error:', e);
    return res.status(500).json({ error: 'Failed to run diagnostics' });
  }
});

module.exports = router;
