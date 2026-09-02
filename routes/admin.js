const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Earning = require('../models/earning');
const Message = require('../models/messeges');
const Withdrawal = require('../models/withdrawal');
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

// ✅ Admin Auth Middleware - verify admin token
function verifyAdminToken(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized - no token' });
  
  // For now, simple token validation (in production, use JWT)
  if (token !== 'admin-local-token') {
    return res.status(403).json({ error: 'Forbidden - invalid token' });
  }
  next();
}

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

function getSMTPConfig() {
  return {
    host: process.env.SMTP_HOST || process.env.SMPT_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || process.env.SMPT_PORT || 587),
    secure: String(process.env.SMTP_SECURE || process.env.SMPT_SECURE || 'false').toLowerCase() === 'true',
    user: process.env.SMTP_USER || process.env.SMPT_USER || 'watch2earn36@gmail.com',
    pass: process.env.SMTP_PASS || process.env.SMPT_PASS || process.env.GMAIL_APP_PASSWORD || ''
  };
}

function buildAdminEmailTransport() {
  if (!nodemailer) return null;
  const cfg = getSMTPConfig();
  if (!cfg.pass) return null;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass }
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

router.get('/inbox', verifyAdminToken, async (req, res) => {
  try {
    let inboxMessages = [];
    if (isMongooseReady()) {
      try {
        // Use Message model (user messages) and also admin_messages collection for admin inbox
        const userMessages = await Message.find({}).sort({ createdAt: -1 }).limit(500).lean();
        inboxMessages = (userMessages || []).map(m => ({ id: m._id?.toString?.() || m.id, from: m.from || m.userId || null, message: m.message || '', type: m.type || 'user_message', createdAt: m.createdAt || m.createdAt }));
      } catch (e) {
        inboxMessages = readJson(MESSAGES_PATH).filter(Boolean);
      }
    } else {
      inboxMessages = readJson(MESSAGES_PATH).filter(Boolean);
    }

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

// GET /api/admin/approvals - return pending withdrawals and approval items
router.get('/approvals', verifyAdminToken, async (req, res) => {
  try {
    let withdrawals = [];
    let users = [];

    // Try MongoDB first
    if (isMongooseReady()) {
      withdrawals = await Withdrawal.find({}).sort({ createdAt: -1 }).lean();
      users = await User.find({}).lean();
    } else {
      // Fallback to files
      const withdrawalsPath = path.join(DATA_DIR, 'withdrawals.json');
      const usersPath = path.join(DATA_DIR, 'users.json');
      try { withdrawals = JSON.parse(fs.readFileSync(withdrawalsPath, 'utf8') || '[]'); } catch (e) { withdrawals = []; }
      try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { users = []; }
    }

    const mapped = (withdrawals || []).map(w => {
      const user = users.find(u => (u.id && String(u.id) === String(w.userId)) || (u.firebaseUid && String(u.firebaseUid) === String(w.userId)) || (u.uid && String(u.uid) === String(w.userId)) || (u._id && String(u._id) === String(w.userId))) || {};
      return {
        id: w.id || w._id?.toString?.() || ('W-' + (w.id || Math.random().toString(36).slice(2,8))),
        type: 'withdrawal',
        userName: user.displayName || user.username || w.name || (user.email || '').split('@')[0] || 'User',
        userEmail: user.email || w.email || '',
        userId: user.id || user.uid || user.firebaseUid || w.userId || null,
        amount: w.amount || w.value || 0,
        method: w.method || w.paymentMethod || (w.bank ? 'Bank' : 'Unknown'),
        status: w.status || 'pending',
        requestedAt: w.requestedAt || w.createdAt || new Date().toISOString(),
        bankDetails: w.bankDetails || w.bank || null,
        accountName: w.accountName || (w.bankDetails && w.bankDetails.accountName) || null,
        accountNumber: w.accountNumber || (w.bankDetails && w.bankDetails.accountNumber) || null,
        bankName: w.bankName || (w.bankDetails && w.bankDetails.bankName) || null,
        walletAddress: w.walletAddress || (w.bankDetails && w.bankDetails.walletAddress) || null,
        cryptoType: w.cryptoType || (w.bankDetails && w.bankDetails.cryptoType) || null,
        accountAge: user.createdAt || null,
        totalEarnings: user.totalEarned || user.balance || 0,
        previousWithdrawals: (user.withdrawals && user.withdrawals.length) || 0
      };
    });

    return res.json(mapped);
  } catch (error) {
    console.error('Approvals error:', error);
    return res.status(500).json({ error: 'Failed to load approvals' });
  }
});

// PUT /api/admin/approvals/:id - approve or reject a withdrawal/approval
router.put('/approvals/:id', verifyAdminToken, async (req, res) => {
  try {
    const id = req.params.id;
    const { action, reason } = req.body || {};
    if (!action || !['approve','reject','approve_withdrawal','reject_withdrawal'].includes(action) && !['approve','reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    // Try MongoDB first
    if (isMongooseReady()) {
      // Accept either ObjectId or string id stored in record
      let withdrawal = null;
      if (mongoose.Types.ObjectId.isValid(id)) {
        withdrawal = await Withdrawal.findOne({ _id: id });
      }
      if (!withdrawal) {
        withdrawal = await Withdrawal.findOne({ id: id });
      }

      if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });

      if (action === 'approve' || action === 'approve_withdrawal') {
        withdrawal.status = 'approved';
        withdrawal.approvedAt = new Date().toISOString();
        await withdrawal.save();
        return res.json({ ok: true, item: withdrawal });
      }

      if (action === 'reject' || action === 'reject_withdrawal') {
        // Only refund if not already rejected
        const wasPending = String(withdrawal.status || '').toLowerCase() !== 'rejected';
        withdrawal.status = 'rejected';
        withdrawal.approvedAt = new Date().toISOString();
        withdrawal.rejectionReason = reason || '';
        await withdrawal.save();

        if (wasPending) {
          // refund amount back to user wallet
          try {
            const amt = Number(withdrawal.amount || 0);
            if (amt > 0) {
              await User.findOneAndUpdate({ $or: [ { firebaseUid: withdrawal.userId }, { uid: withdrawal.userId }, { id: withdrawal.userId } ] }, { $inc: { wallet: amt, balance: amt } });
            }
          } catch (e) { console.warn('Refund on reject (mongo) failed:', e && e.message); }
        }

        return res.json({ ok: true, item: withdrawal });
      }
    }

    // Fallback to file-based data
    const withdrawalsPath = path.join(DATA_DIR, 'withdrawals.json');
    let withdrawals = [];
    try { withdrawals = JSON.parse(fs.readFileSync(withdrawalsPath, 'utf8') || '[]'); } catch (e) { withdrawals = []; }
    const idx = withdrawals.findIndex(w => String(w.id || w._id) === String(id));
    if (idx === -1) return res.status(404).json({ error: 'Withdrawal not found' });

    if (action === 'approve' || action === 'approve_withdrawal') {
      withdrawals[idx].status = 'approved';
      withdrawals[idx].approvedAt = new Date().toISOString();
    } else {
      const wasPending = String(withdrawals[idx].status || '').toLowerCase() !== 'rejected';
      withdrawals[idx].status = 'rejected';
      withdrawals[idx].rejectionReason = reason || '';
      // refund in file-based users
      if (wasPending) {
        try {
          const usersPath = path.join(DATA_DIR, 'users.json');
          const users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]');
          const targetUserId = withdrawals[idx].userId;
          const uidx = users.findIndex(u => (u.firebaseUid && String(u.firebaseUid) === String(targetUserId)) || (u.uid && String(u.uid) === String(targetUserId)) || (u.id && String(u.id) === String(targetUserId)));
          const amt = Number(withdrawals[idx].amount || 0);
          if (uidx >= 0 && amt > 0) {
            users[uidx].balance = Math.max(0, (Number(users[uidx].balance || users[uidx].wallet || 0) + amt));
            if (!users[uidx].wallet) users[uidx].wallet = users[uidx].balance;
            fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
          }
        } catch (e) { console.warn('Refund on reject (file) failed:', e && e.message); }
      }
    }

    fs.writeFileSync(withdrawalsPath, JSON.stringify(withdrawals, null, 2));
    return res.json({ ok: true, item: withdrawals[idx] });
  } catch (error) {
    console.error('Update approval error:', error);
    return res.status(500).json({ error: 'Failed to update approval' });
  }
});

// POST /api/admin/inbox/update-status - update a message/alert status
router.post('/inbox/update-status', async (req, res) => {
  try {
    const body = req.body || {};
    const id = String(body.id || '').trim();
    const status = String(body.status || '').trim();
    if (!id || !status) return res.status(400).json({ error: 'id and status required' });

    const items = readJson(MESSAGES_PATH);
    const idx = items.findIndex(m => String(m.id) === id || String(m._id) === id);
    if (idx === -1) return res.status(404).json({ error: 'Message not found' });
    items[idx].status = status;
    fs.writeFileSync(MESSAGES_PATH, JSON.stringify(items, null, 2));
    return res.json({ ok: true, item: items[idx] });
  } catch (error) {
    console.error('Update inbox status error:', error);
    return res.status(500).json({ error: 'Failed to update status' });
  }
});

router.post('/reply-message/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {}; 
    if (isMongooseReady()) {
      // Store replies in admin_messages collection
      const col = (mongoNative && typeof mongoNative.getCollection === 'function') ? mongoNative.getCollection('admin_messages') : mongoose.connection.collection('admin_messages');
      const doc = await col.findOne({ id: id }) || await col.findOne({ _id: safeObjectId(id) });
      if (!doc) return res.status(404).json({ error: 'Message not found' });
      const replies = doc.replies || [];
      replies.push({ reply: body.reply || '', by: 'admin', date: new Date().toISOString() });
      await col.updateOne({ _id: doc._id }, { $set: { replies } });
      return res.json({ ok: true, message: { ...doc, replies } });
    }

    const items = readJson(MESSAGES_PATH);
    const match = items.find(m => String(m.id) === String(id));
    if (!match) return res.status(404).json({ error: 'Message not found' });
    match.replies = match.replies || [];
    match.replies.push({ reply: body.reply || '', by: 'admin', date: new Date().toISOString() });
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

router.get('/users', verifyAdminToken, async (req, res) => {
  try {
    let users = [];
    if (isMongooseReady()) {
      users = await User.find({}).limit(1000).lean();
      // Ensure all users have an id field for frontend compatibility
      users = users.map(u => ({
        ...u,
        id: u.id || u._id?.toString?.() || u.uid || u.firebaseUid || 'unknown'
      }));
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

// GET /api/admin/firebase-users - list users from Firebase Auth
router.get('/firebase-users', verifyAdminToken, async (req, res) => {
  try {
    if (!firebaseAdminAuth) return res.status(500).json({ error: 'Firebase Admin not configured' });
    let users = [];
    let nextPageToken = undefined;
    do {
      const listResult = await firebaseAdminAuth.listUsers(1000, nextPageToken);
      const pageUsers = (listResult.users || []).map(u => ({
        uid: u.uid,
        email: u.email || null,
        disabled: u.disabled || false,
        created: u.metadata && u.metadata.creationTime ? u.metadata.creationTime : null
      }));
      users = users.concat(pageUsers);
      nextPageToken = listResult.pageToken;
    } while (nextPageToken);

    return res.json(users);
  } catch (error) {
    console.error('FIREBASE LIST USERS ERROR:', error);
    return res.status(500).json({ error: error.message || 'Failed to list firebase users' });
  }
});

// POST /api/admin/firebase/ban - disable a Firebase user account and mark as banned in DB (if present)
router.post('/firebase/ban', verifyAdminToken, async (req, res) => {
  try {
    const uid = (req.body && req.body.uid) || (req.body && req.body.firebaseUid) || null;
    if (!uid) return res.status(400).json({ error: 'uid is required' });

    if (firebaseAdminAuth) {
      await firebaseAdminAuth.updateUser(uid, { disabled: true });
    }

    // Also update MongoDB user record if available
    try {
      if (isMongooseReady()) {
        const u = await User.findOne({ $or: [ { firebaseUid: uid }, { uid: uid }, { id: uid } ] });
        if (u) {
          u.isBanned = true;
          u.isSuspended = false;
          u.status = 'banned';
          await u.save();
        }
      }
    } catch (e) { console.warn('Failed to update MongoDB user for ban:', e && e.message); }

    return res.json({ ok: true, uid, status: 'banned' });
  } catch (error) {
    console.error('FIREBASE BAN ERROR:', error);
    return res.status(500).json({ error: error.message || 'Failed to ban user' });
  }
});

// POST /api/admin/firebase/unban - re-enable a Firebase user account and mark active in DB
router.post('/firebase/unban', verifyAdminToken, async (req, res) => {
  try {
    const uid = (req.body && req.body.uid) || (req.body && req.body.firebaseUid) || null;
    if (!uid) return res.status(400).json({ error: 'uid is required' });

    if (firebaseAdminAuth) {
      await firebaseAdminAuth.updateUser(uid, { disabled: false });
    }

    // Also update MongoDB user record if available
    try {
      if (isMongooseReady()) {
        const u = await User.findOne({ $or: [ { firebaseUid: uid }, { uid: uid }, { id: uid } ] });
        if (u) {
          u.isBanned = false;
          u.isSuspended = false;
          u.status = 'active';
          await u.save();
        }
      }
    } catch (e) { console.warn('Failed to update MongoDB user for unban:', e && e.message); }

    return res.json({ ok: true, uid, status: 'active' });
  } catch (error) {
    console.error('FIREBASE UNBAN ERROR:', error);
    return res.status(500).json({ error: error.message || 'Failed to unban user' });
  }
});

router.get('/messages', verifyAdminToken, async (req, res) => {
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
      expiresAt: body.expiresAt || body.expires || body.expiry || body.expires_at || null,
      frequency: body.frequency || 'once',
      priority: body.priority || 'normal',
      status: body.status || (body.sendType === 'automatic' ? 'scheduled' : 'sent'),
      createdAt: new Date().toISOString(),
      from: process.env.FROM_EMAIL || process.env.SMTP_USER || 'watch2earn36@gmail.com'
    };

    // Persist to MongoDB if available (admin messages collection)
    if (isMongooseReady()) {
      try {
        const col = (mongoNative && typeof mongoNative.getCollection === 'function') ? mongoNative.getCollection('admin_messages') : mongoose.connection.collection('admin_messages');
        await col.insertOne(entry);
      } catch (e) {
        console.warn('Admin message Mongo insert failed:', e && e.message);
      }
    }

    // Fallback file storage (keep existing behavior)
    const items = readJson(MESSAGES_PATH);
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
    if (isMongooseReady()) {
      try {
        const col = (mongoNative && typeof mongoNative.getCollection === 'function') ? mongoNative.getCollection('admin_messages') : mongoose.connection.collection('admin_messages');
        await col.deleteOne({ $or: [{ id: id }, { _id: safeObjectId(id) }] });
      } catch (e) { console.warn('Admin message Mongo delete failed:', e && e.message); }
    }
    const items = readJson(MESSAGES_PATH).filter(Boolean).filter(m => String(m.id) !== String(id));
    writeJson(MESSAGES_PATH, items);
    return res.json({ ok: true });
  } catch (e) { console.error('Delete message error:', e); return res.status(500).json({ error: 'Failed to delete message' }); }
});

// Incoming email webhook - save incoming email to messages.json
router.post('/incoming-email', express.json(), async (req, res) => {
  try {
    const { from, subject, text, html } = req.body || {};
    const entry = { id: Date.now().toString(), from: from || 'unknown', title: subject || 'Email', message: text || (html || ''), type: 'email', createdAt: new Date().toISOString() };

    if (isMongooseReady()) {
      try {
        const col = (mongoNative && typeof mongoNative.getCollection === 'function') ? mongoNative.getCollection('admin_messages') : mongoose.connection.collection('admin_messages');
        await col.insertOne(entry);
      } catch (e) { console.warn('Incoming email Mongo insert failed:', e && e.message); }
    }

    const items = readJson(MESSAGES_PATH);
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
    let tx = [];
    
    // Try Mongo first, but also include file-based transactions
    if (isMongooseReady()) {
      try {
        const mongoTx = await Earning.find({}).sort({ createdAt: -1 }).limit(1000).lean();
        tx = (mongoTx || []).map(t => ({
          id: t._id?.toString?.() || t.id,
          userId: t.userId || t.firebaseUid,
          type: t.type || 'earning',
          amount: t.amount || 0,
          amountUsd: t.amountUsd || t.amount || 0,
          date: t.createdAt || t.date,
          createdAt: t.createdAt || t.date,
          title: t.description || `${t.type} earned`,
          source: t.source || 'system'
        }));
      } catch (e) {
        console.warn('Mongo history fetch failed:', e && e.message);
      }
    }
    
    // Always check and merge file-based transactions
    try {
      const fileTx = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'transactions.json'), 'utf8') || '[]');
      const fileTxFormatted = (fileTx || []).map(t => ({
        id: t.id,
        userId: t.userId || t.firebaseUid,
        type: t.type || 'other',
        amount: t.amountNaira || t.amount || 0,
        amountUsd: t.amountUsd || t.amount || 0,
        date: t.date || t.createdAt,
        createdAt: t.date || t.createdAt,
        title: t.title || `${t.type} earned`,
        source: t.source || 'file'
      }));
      
      // Merge: keep Mongo records, add file records if not already present
      const ids = new Set(tx.map(t => t.id));
      fileTxFormatted.forEach(ft => {
        if (!ids.has(ft.id)) {
          tx.push(ft);
          ids.add(ft.id);
        }
      });
    } catch (e) {
      console.warn('File transaction fetch failed:', e && e.message);
    }
    
    // Sort merged result by date descending
    tx.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
    
    return res.json(tx.slice(0, 1000));
  } catch (e) { 
    console.error('History fetch error:', e);
    res.status(500).json({ error: 'Failed to read history' }); 
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    // Provide dashboard fields expected by frontend: totalBalance, profit, userProfit, users, withdrawals, revenue, activity
    if (isMongooseReady()) {
      const totalUsers = await User.countDocuments();
      // Sum user wallets
      const balAgg = await User.aggregate([{ $group: { _id: null, totalBalance: { $sum: { $ifNull: ["$wallet", 0] } } } }]);
      const totalBalance = (balAgg[0] && balAgg[0].totalBalance) || 0;

      // Total user earnings (sum of Earning.amount)
      const earnAgg = await Earning.aggregate([{ $group: { _id: null, totalEarned: { $sum: { $ifNull: ["$amount", 0] } } } }]);
      const userProfit = (earnAgg[0] && earnAgg[0].totalEarned) || 0;

      // Total withdrawn (approved)
      let withdrawnSum = 0;
      try {
        const wdAgg = await Withdrawal.aggregate([{ $match: { status: { $in: ['approved','Approved'] } } }, { $group: { _id: null, total: { $sum: { $ifNull: ["$amount", 0] } } } }]);
        withdrawnSum = (wdAgg[0] && wdAgg[0].total) || 0;
      } catch (e) { withdrawnSum = 0; }

      const profit = Math.max(0, (userProfit - withdrawnSum));

      const pendingWithdrawals = await Withdrawal.countDocuments({ status: { $in: ['Pending','pending','PENDING'] } });

      // Recent activity (last 8 earnings)
      const recent = await Earning.find({}).sort({ createdAt: -1 }).limit(8).lean();
      const activity = (recent || []).map(r => `${r.type || 'earning'}: ${r.amount || 0} ${r.amountUsd ? '($' + r.amountUsd + ')' : ''}`);

      return res.json({ totalBalance, profit, userProfit, users: totalUsers, withdrawals: pendingWithdrawals, revenue: userProfit, activity });
    }

    // Fallback to file-based metrics
    const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8') || '[]');
    const tx = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'transactions.json'), 'utf8') || '[]');
    const wd = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'withdrawals.json'), 'utf8') || '[]');

    const totalUsers = users.length;
    const totalBalance = users.reduce((s,u) => s + Number(u.wallet || u.balance || 0), 0);
    const userProfit = tx.reduce((s,t) => s + Number(t.amount || t.amountUsd || 0), 0);
    const withdrawnSum = wd.filter(w => w.status && String(w.status).toLowerCase().includes('approv')).reduce((s,w) => s + Number(w.amount||0), 0);
    const profit = Math.max(0, userProfit - withdrawnSum);
    const pendingWithdrawals = wd.filter(w => String(w.status || '').toLowerCase().includes('pend')).length;
    const recentActivity = tx.slice(0,8).map(t => `${t.type || 'txn'}: ${t.amount || t.amountUsd || 0}`);

    return res.json({ totalBalance, profit, userProfit, users: totalUsers, withdrawals: pendingWithdrawals, revenue: userProfit, activity: recentActivity });
  } catch (e) { res.status(500).json({ error: 'Failed to compute dashboard' }); }
});

// GET /api/admin/leaderboard - aggregated leaderboards: referral, ads, withdrawals
router.get('/leaderboard', async (req, res) => {
  try {
    if (isMongooseReady()) {
      // Top referrers: count users grouped by referredBy
      const refAgg = await User.aggregate([
        { $match: { referredBy: { $ne: null } } },
        { $group: { _id: '$referredBy', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 50 }
      ]);

      const referral = [];
      for (const r of refAgg) {
        const u = await User.findById(r._id).lean();
        if (u) referral.push({ userId: u._id.toString(), name: u.displayName || u.username || u.email, count: r.count });
      }

      // Ads watched leaderboard: count earnings of type ad_watch
      const adsAgg = await Earning.aggregate([
        { $match: { type: 'ad_watch' } },
        { $group: { _id: '$userId', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 50 }
      ]);
      const ads = [];
      for (const a of adsAgg) {
        const u = await User.findById(a._id).lean();
        if (u) ads.push({ userId: u._id.toString(), name: u.displayName || u.username || u.email, count: a.count });
      }

      // Withdrawals: highest total withdrawn per user
      const wdAgg = await Withdrawal.aggregate([
        { $match: { status: { $in: ['approved','Approved','approved'] } } },
        { $group: { _id: '$userId', total: { $sum: '$amount' } } },
        { $sort: { total: -1 } },
        { $limit: 50 }
      ]);
      const withdrawals = [];
      for (const w of wdAgg) {
        // w._id may be ObjectId or string
        const user = await User.findOne({ $or: [ { _id: safeObjectId(w._id) }, { id: String(w._id) }, { firebaseUid: String(w._id) } ] }).lean();
        withdrawals.push({ userId: w._id, name: user ? (user.displayName || user.username || user.email) : String(w._id), total: w.total });
      }

      return res.json({ referral, ads, withdrawals });
    }

    // Fallback: compute from data files
    const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8') || '[]');
    const tx = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'transactions.json'), 'utf8') || '[]');
    const referralsMap = {};
    users.forEach(u => { if (u.referredBy) referralsMap[u.referredBy] = (referralsMap[u.referredBy]||0) + 1; });
    const referral = Object.keys(referralsMap).map(k => ({ userId: k, name: (users.find(x=>x.id===k)||{}).displayName || (users.find(x=>x.id===k)||{}).username || k, count: referralsMap[k] })).sort((a,b)=>b.count-a.count).slice(0,50);

    const adsMap = {};
    tx.filter(t=>t.type==='ad').forEach(t => { adsMap[t.userId] = (adsMap[t.userId]||0) + 1; });
    const ads = Object.keys(adsMap).map(k => ({ userId: k, name: (users.find(x=>x.id===k)||{}).displayName || (users.find(x=>x.id===k)||{}).username || k, count: adsMap[k] })).sort((a,b)=>b.count-a.count).slice(0,50);

    const wdMap = {};
    const withdrawalsFile = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'withdrawals.json'), 'utf8') || '[]');
    withdrawalsFile.filter(w=>w.status && String(w.status).toLowerCase().includes('approv')).forEach(w=>{ wdMap[w.userId] = (wdMap[w.userId]||0) + Number(w.amount||0); });
    const withdrawals = Object.keys(wdMap).map(k => ({ userId: k, name: (users.find(x=>x.id===k)||{}).displayName || (users.find(x=>x.id===k)||{}).username || k, total: wdMap[k] })).sort((a,b)=>b.total-a.total).slice(0,50);

    return res.json({ referral, ads, withdrawals });
  } catch (e) {
    console.error('Leaderboard error:', e);
    return res.status(500).json({ error: 'Failed to compute leaderboard' });
  }
});

router.get('/bonuses', (req, res) => {
  try {
    const bonuses = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bonuses.json'), 'utf8') || '[]');
    res.json(bonuses);
  } catch (e) { res.status(500).json({ error: 'Failed to read bonuses' }); }
});

router.post('/send-bonus', verifyAdminToken, async (req, res) => {
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

router.put('/users/:id', verifyAdminToken, async (req, res) => {
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
        errs.unshift({ id: id || null, body: body || null, ip: req.ip || null, time: new Date().toISOString(), admin: (req.user && req.user.email) || null });
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

      const cfg = getSMTPConfig();
      const FROM_EMAIL = process.env.FROM_EMAIL || process.env.SMTP_FROM || cfg.user || 'watch2earn@gmail.com';
      if (nodemailer && cfg.host && cfg.user && cfg.pass) {
        try {
          const transporter = nodemailer.createTransport({ host: cfg.host, port: cfg.port, secure: cfg.secure, auth: { user: cfg.user, pass: cfg.pass } });
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

// GET /api/admin/activity-logs - retrieve paginated activity logs with optional filtering
router.get('/activity-logs', async (req, res) => {
  try {
    const page = Number(req.query.page || 0);
    const limit = Number(req.query.limit || 50);
    const userId = req.query.userId || null;
    const route = req.query.route || null;
    const sortBy = req.query.sortBy || 'timestamp'; // timestamp, userId, route
    const order = req.query.order === 'asc' ? 1 : -1; // -1 = desc (default)

    let logs = [];
    let total = 0;

    // Try Mongo first
    try {
      if (mongoNative && typeof mongoNative.getCollection === 'function') {
        const col = mongoNative.getCollection('user_activity');
        const query = {};
        if (userId) query.userId = userId;
        if (route) query.route = { $regex: route, $options: 'i' };

        total = await col.countDocuments(query);
        const sortObj = {};
        sortObj[sortBy] = order;
        logs = await col.find(query)
          .sort(sortObj)
          .skip(page * limit)
          .limit(limit)
          .toArray();
        return res.json({ logs, total, page, limit, hasMore: (page + 1) * limit < total });
      }
    } catch (e) {
      console.warn('Mongo activity log fetch failed:', e && e.message);
    }

    // Fallback to file
    const logsPath = path.join(DATA_DIR, 'user_logs.json');
    if (fs.existsSync(logsPath)) {
      let allLogs = JSON.parse(fs.readFileSync(logsPath, 'utf8') || '[]');
      
      // Filter
      if (userId) allLogs = allLogs.filter(l => l.userId === userId);
      if (route) allLogs = allLogs.filter(l => l.route && l.route.includes(route));

      // Sort
      allLogs.sort((a, b) => {
        let aVal = a[sortBy];
        let bVal = b[sortBy];
        if (typeof aVal === 'string') aVal = aVal.toLowerCase();
        if (typeof bVal === 'string') bVal = bVal.toLowerCase();
        if (aVal < bVal) return -order;
        if (aVal > bVal) return order;
        return 0;
      });

      total = allLogs.length;
      logs = allLogs.slice(page * limit, (page + 1) * limit);
    }

    return res.json({ logs, total, page, limit, hasMore: (page + 1) * limit < total });
  } catch (e) {
    console.error('Activity logs error:', e);
    return res.status(500).json({ error: 'Failed to load activity logs' });
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

// ===== CHART ENDPOINTS =====
// GET /api/admin/chart/earnings - Chart data for earnings over time
router.get('/chart/earnings', async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    const now = new Date();
    const data = [];
    const labels = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      labels.push(dateStr);
      // Placeholder data - would sum earnings for this date in production
      data.push(Math.round(Math.random() * 500) / 100);
    }

    return res.json({ labels, data });
  } catch (e) {
    console.error('Chart earnings error:', e);
    return res.status(500).json({ error: 'Failed to load chart data' });
  }
});

// GET /api/admin/chart/ads-watched - Chart data for ads watched over time
router.get('/chart/ads-watched', async (req, res) => {
  try {
    const days = Number(req.query.days || 30);
    const now = new Date();
    const data = [];
    const labels = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      labels.push(dateStr);
      // Placeholder data - would count ads for this date in production
      data.push(Math.floor(Math.random() * 500));
    }

    return res.json({ labels, data });
  } catch (e) {
    console.error('Chart ads-watched error:', e);
    return res.status(500).json({ error: 'Failed to load chart data' });
  }
});

// GET /api/admin/chart/earnings-summary - Summary of earnings for different time periods
router.get('/chart/earnings-summary', async (req, res) => {
  try {
    // Return earnings data for different periods
    return res.json({
      '1-day': '$125.50',
      '7-days': '$742.25',
      '30-days': '$3,156.80',
      '90-days': '$9,845.30'
    });
  } catch (e) {
    console.error('Chart earnings-summary error:', e);
    return res.status(500).json({ error: 'Failed to load summary data' });
  }
});

// GET /api/admin/suspects - Get banned and suspended users (suspects)
router.get('/suspects', verifyAdminToken, async (req, res) => {
  try {
    let users = [];
    let appeals = [];
    if (isMongooseReady()) {
      users = await User.find({
        $or: [
          { isBanned: true },
          { isSuspended: true },
          { status: { $in: ['banned', 'suspended'] } }
        ]
      }).limit(500).lean();
    } else {
      const usersPath = path.join(DATA_DIR, 'users.json');
      try {
        const allUsers = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]');
        users = allUsers.filter(u => u.isBanned || u.isSuspended || u.status === 'banned' || u.status === 'suspended');
      } catch (e) {
        users = [];
      }
    }

    try {
      appeals = readAppeals();
    } catch (e) {
      appeals = [];
    }

    const banned = users.filter(u => u.isBanned || u.status === 'banned');
    const suspended = users.filter(u => u.isSuspended || u.status === 'suspended');

    return res.json({ users, banned, suspended, appeals, total: users.length });
  } catch (e) {
    console.error('Suspects error:', e);
    return res.status(500).json({ error: 'Failed to load suspects' });
  }
});

// GET /api/admin/user/:id - Get single user profile with earnings and summary
router.get('/user/:id', verifyAdminToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!id || id === 'undefined' || id === 'null') {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const user = await findUserByAdminIdentifier(id, null);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Build basic profile
    const profile = {
      id: user.id || user._id?.toString?.() || user.uid || user.firebaseUid || 'unknown',
      name: user.displayName || user.username || user.firstName || user.lastName || user.email || 'Unknown',
      email: user.email || 'N/A',
      status: user.status || (user.isBanned ? 'banned' : user.isSuspended ? 'suspended' : 'active'),
      wallet: user.wallet || 0,
      balance: user.balance || 0,
      verified: user.verified || user.promoted || false,
      referralCode: user.referralCode || '',
      referredBy: user.referredBy || null,
      createdAt: user.createdAt || user.created || null
    };

    // Fetch transactions/earnings
    let transactions = [];
    if (isMongooseReady()) {
      const earnings = await Earning.find({ 
        $or: [
          { userId: user._id },
          { userId: String(user._id) },
          { firebaseUid: user.firebaseUid }
        ]
      }).sort({ createdAt: -1 }).limit(200).lean();
      
      transactions = (earnings || []).map(e => ({
        id: e._id?.toString?.() || e.id,
        type: e.type || 'other',
        amount: e.amount || 0,
        amountUsd: e.amountUsd || e.amount || 0,
        description: e.description || `${e.type} earned`,
        date: e.createdAt || e.date,
        createdAt: e.createdAt || e.date,
        title: `${e.type} earning`
      }));
    } else {
      // Fallback to file-based transactions
      const transactionsPath = path.join(DATA_DIR, 'transactions.json');
      try {
        const allTx = JSON.parse(fs.readFileSync(transactionsPath, 'utf8') || '[]');
        transactions = (allTx || [])
          .filter(t => t.userId === profile.id || t.firebaseUid === user.firebaseUid)
          .map(t => ({
            id: t.id,
            type: t.type || 'other',
            amount: t.amount || 0,
            amountUsd: t.amountUsd || t.amount || 0,
            description: t.description || `${t.type} earned`,
            date: t.date || t.createdAt,
            createdAt: t.date || t.createdAt,
            title: `${t.type} earning`
          }))
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 200);
      } catch (e) {
        transactions = [];
      }
    }

    // Calculate summary: group by type and sum amounts
    const summaryMap = {
      total: 0,
      ads: 0,
      referrals: 0,
      bonus: 0,
      game: 0,
      survey: 0,
      telegram: 0,
      other: 0
    };

    transactions.forEach(tx => {
      const amount = Number(tx.amountUsd || tx.amount || 0);
      const type = (tx.type || 'other').toLowerCase();
      
      summaryMap.total += amount;
      
      if (type.includes('ad')) summaryMap.ads += amount;
      else if (type.includes('referral') || type.includes('commission')) summaryMap.referrals += amount;
      else if (type.includes('bonus')) summaryMap.bonus += amount;
      else if (type.includes('game')) summaryMap.game += amount;
      else if (type.includes('survey')) summaryMap.survey += amount;
      else if (type.includes('telegram')) summaryMap.telegram += amount;
      else summaryMap.other += amount;
    });

    return res.json({
      ...profile,
      transactions,
      summary: summaryMap
    });
  } catch (error) {
    console.error('Get user profile error:', error);
    return res.status(500).json({ error: 'Failed to load user profile' });
  }
});

module.exports = router;
