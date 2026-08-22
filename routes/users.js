const express = require('express');
const router = express.Router();
const { db } = require('../config/firebaseAdmin');
const verifyToken = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

// Mongoose models
const User = require('../models/User');
const Earning = require('../models/earning');
const Message = require('../models/messeges');

// -------------------- PROFILE --------------------
// GET user profile — compute live balances from data/transactions.json when available
router.get('/profile', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;
  const DATA_DIR = path.join(__dirname, '..', 'data');
  const TXN_PATH = path.join(DATA_DIR, 'transactions.json');

  try {
    // try to compute from local transactions file first
    let txs = [];
    try {
      if (fs.existsSync(TXN_PATH)) {
        txs = JSON.parse(fs.readFileSync(TXN_PATH, 'utf8') || '[]');
      }
    } catch (e) {
      txs = [];
    }

    const myTx = txs.filter(t => t.userId === userId);
    const totalUsd = myTx.reduce((s, t) => s + Number(t.amountUsd || 0), 0);
    const adsUsd = myTx.filter(t => (t.type || '').toLowerCase().includes('ad')).reduce((s, t) => s + Number(t.amountUsd || 0), 0);
    const gameUsd = myTx.filter(t => (t.type || '').toLowerCase().includes('game')).reduce((s, t) => s + Number(t.amountUsd || 0), 0);
    const surveyUsd = myTx.filter(t => (t.type || '').toLowerCase().includes('survey')).reduce((s, t) => s + Number(t.amountUsd || 0), 0);
    const refUsd = myTx.filter(t => (t.type || '').toLowerCase().includes('referral') || (t.type || '').toLowerCase().includes('commission')).reduce((s, t) => s + Number(t.amountUsd || 0), 0);

    // invited count and announcement — try firestore but it's optional
    let displayName = req.user.name || 'User';
    let email = req.user.email || '';
    let invitedCount = 0;
    let announcement = '';
    try {
      const userDoc = await db.collection('users').doc(userId).get();
      const u = userDoc.exists ? userDoc.data() : null;
      displayName = u?.displayName || displayName;
      email = u?.email || email;
      invitedCount = u?.invitedCount || 0;
      announcement = u?.announcement || '';
    } catch (e) {
      // ignore firestore errors — we'll still return computed values
    }

    return res.json({
      balanceUsd: +totalUsd.toFixed(6),
      adsEarn: +adsUsd.toFixed(6),
      gameEarn: +gameUsd.toFixed(6),
      surveyEarn: +surveyUsd.toFixed(6),
      refEarn: +refUsd.toFixed(6),
      invitedCount: invitedCount || 0,
      announcement,
      displayName,
      email
    });

  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// -------------------- EARNINGS --------------------
// GET user earning history (from MongoDB) - grouped by type with date and time
router.get('/earnings/:firebaseUid', verifyToken, async (req, res) => {
  try {
    const earnings = await Earning.find({ firebaseUid: req.params.firebaseUid })
      .sort({ createdAt: -1 })
      .limit(200);
    
    const byType = {};
    earnings.forEach(e => {
      const type = e.type || 'other';
      if (!byType[type]) byType[type] = [];
      byType[type].push({
        amount: e.amount,
        description: e.description,
        date: e.createdAt,
        time: new Date(e.createdAt).toLocaleTimeString()
      });
    });
    
    res.json({ byType, total: earnings.length });
  } catch (err) {
    console.error('Earnings error:', err);
    res.status(500).json({ error: 'Failed to fetch earnings' });
  }
});

// -------------------- MESSAGES --------------------
// GET user messages (from MongoDB)
router.get('/messages/:firebaseUid', verifyToken, async (req, res) => {
  try {
    const messages = await Message.find({ firebaseUid: req.params.firebaseUid })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(messages);
  } catch (err) {
    console.error('Messages error:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// -------------------- EARNING HISTORY TABLE --------------------
// GET detailed earning history as table format
router.get('/earning-history/:firebaseUid', verifyToken, async (req, res) => {
  try {
    const earnings = await Earning.find({ firebaseUid: req.params.firebaseUid })
      .sort({ createdAt: -1 })
      .limit(500);
    
    const byType = {};
    let totalEarned = 0;
    
    earnings.forEach(e => {
      const type = e.type || 'other';
      if (!byType[type]) byType[type] = { total: 0, items: [] };
      byType[type].items.push({
        amount: e.amount,
        description: e.description,
        date: new Date(e.createdAt).toLocaleDateString(),
        time: new Date(e.createdAt).toLocaleTimeString(),
        timestamp: e.createdAt
      });
      byType[type].total += e.amount;
      totalEarned += e.amount;
    });
    
    res.json({ byType, totalEarned, count: earnings.length });
  } catch (err) {
    console.error('Earning history error:', err);
    res.status(500).json({ error: 'Failed to fetch earning history' });
  }
});

const mongoNative = require('../mongodb');

// GET /api/users/promoted-status - returns { promoted: bool, pending: bool, invitedCount, invitedEmails, activeCount, passiveCount, referralLink }
router.get('/promoted-status', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    let promoted = false;
    let pending = false;
    let invitedCount = 0;
    let invitedEmails = [];
    let activeCount = 0;
    let passiveCount = 0;
    let referralLink = null;

    // Prefer mongoose for richer queries
    if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
      const u = await User.findOne({ $or: [{ _id: userId }, { id: userId }, { uid: userId }, { firebaseUid: userId }, { email: (req.user.email || '').toLowerCase() }] }).lean();
      promoted = !!(u && u.promoted);
      pending = !!(u && u.promoteCode);
      referralLink = u ? `${req.protocol}://${req.get('host')}/?ref=${u.uid || u.id || u.firebaseUid || ''}` : null;

      if (u) {
        const invited = await User.find({ referredBy: u._id }).lean();
        invitedCount = invited.length;
        invitedEmails = invited.map(i => i.email).filter(Boolean);

        // Determine activity window (7 days)
        const activeWindow = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
        // If mongoNative activity collection is available, use it to detect recent activity
        try {
          if (mongoNative && typeof mongoNative.getCollection === 'function') {
            const actCol = mongoNative.getCollection('user_activity');
            const checks = await Promise.all(invited.map(async (inv) => {
              const uid = inv.firebaseUid || inv.uid || inv.id || null;
              if (!uid) return false;
              const recent = await actCol.findOne({ userId: uid, timestamp: { $gte: activeWindow.toISOString() } });
              return !!recent || ((inv.balance || inv.totalEarned || 0) > 0);
            }));
            activeCount = checks.filter(Boolean).length;
            passiveCount = invitedCount - activeCount;
          } else {
            // Fallback: use file-based user_logs
            const DATA_DIR = path.join(__dirname, '..', 'data');
            const logsPath = path.join(DATA_DIR, 'user_logs.json');
            let logs = [];
            try { logs = JSON.parse(fs.readFileSync(logsPath, 'utf8') || '[]'); } catch (e) { logs = []; }
            invited.forEach(inv => {
              const uid = inv.firebaseUid || inv.uid || inv.id || null;
              const hasRecent = logs.find(l => l.userId && uid && String(l.userId) === String(uid) && new Date(l.timestamp) >= activeWindow);
              if (hasRecent || ((inv.balance || inv.totalEarned || 0) > 0)) activeCount++;
            });
            passiveCount = invitedCount - activeCount;
          }
        } catch (e) {
          // fallback to balance-only computation
          activeCount = invited.filter(i => (i.balance || i.totalEarned || 0) > 0).length;
          passiveCount = invitedCount - activeCount;
        }
      }

      return res.json({ promoted, pending, invitedCount, invitedEmails, activeCount, passiveCount, referralLink });
    }

    // Fallback to file-based computations
    const DATA_DIR = path.join(__dirname, '..', 'data');
    const usersPath = path.join(DATA_DIR, 'users.json');
    let users = [];
    try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { users = []; }
    const u = users.find(x => (x.id === userId) || (x.uid === userId) || ((x.email||'').toLowerCase() === (req.user.email||'').toLowerCase()));
    promoted = !!(u && u.promoted);
    pending = !!(u && u.promoteCode);
    referralLink = u ? `${req.protocol}://${req.get('host')}/?ref=${u.uid || u.id || ''}` : null;
    if (u) {
      const invited = users.filter(x => x.referredBy === (u.id || u.uid));
      invitedCount = invited.length;
      invitedEmails = invited.map(i => i.email).filter(Boolean);
      activeCount = invited.filter(i => (i.balance || i.totalEarned || 0) > 0).length;
      passiveCount = invitedCount - activeCount;
    }

    return res.json({ promoted, pending, invitedCount, invitedEmails, activeCount, passiveCount, referralLink });
  } catch (e) { console.error('promoted-status error', e); res.status(500).json({ error: 'Failed to read promoted status' }); }
});

// POST /api/users/verify-promo - verify promo code submitted by user
router.post('/verify-promo', verifyToken, async (req, res) => {
  try {
    const code = (req.body && req.body.code) ? String(req.body.code).trim() : null;
    if (!code) return res.status(400).json({ error: 'Code required' });
    const userId = req.user.uid || req.user.id;

    if (mongoose && mongoose.connection && mongoose.connection.readyState === 1) {
      const u = await User.findOne({ $or: [{ uid: userId }, { firebaseUid: userId }, { id: userId }] });
      if (!u) return res.status(404).json({ error: 'User not found' });
      if (!u.promoteCode) return res.status(400).json({ error: 'No pending code' });
      if (u.promoteExpires && new Date(u.promoteExpires) < new Date()) return res.status(400).json({ error: 'Code expired' });
      if (String(u.promoteCode) !== String(code)) return res.status(400).json({ error: 'Invalid code' });
      u.promoted = true;
      u.promotedAt = new Date();
      u.promoteCode = null;
      u.promoteExpires = null;
      await u.save();
      return res.json({ ok: true });
    }

    // fallback file
    const DATA_DIR = path.join(__dirname, '..', 'data');
    const usersPath = path.join(DATA_DIR, 'users.json');
    let users = [];
    try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { users = []; }
    const u = users.find(x => (x.uid === userId) || (x.id === userId) || ((x.email||'').toLowerCase() === (req.user.email||'').toLowerCase()));
    if (!u) return res.status(404).json({ error: 'User not found' });
    if (!u.promoteCode) return res.status(400).json({ error: 'No pending code' });
    if (u.promoteExpires && new Date(u.promoteExpires) < new Date()) return res.status(400).json({ error: 'Code expired' });
    if (String(u.promoteCode) !== String(code)) return res.status(400).json({ error: 'Invalid code' });
    u.promoted = true; u.promotedAt = new Date().toISOString(); u.promoteCode = null; u.promoteExpires = null;
    fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
    return res.json({ ok: true });
  } catch (e) { console.error('verify-promo error', e); res.status(500).json({ error: 'Failed to verify code' }); }
});

// POST /api/users/suspend-appeal - suspended users submit a request to be reviewed
router.post('/suspend-appeal', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    const message = String((req.body && req.body.message) || '').trim();
    if (!message || message.split(/\s+/).filter(Boolean).length < 100) {
      return res.status(400).json({ error: 'Your appeal must be at least 100 words.' });
    }

    const appealsDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(appealsDir)) fs.mkdirSync(appealsDir, { recursive: true });
    const appealsPath = path.join(appealsDir, 'appeals.json');
    
    let appeals = [];
    if (fs.existsSync(appealsPath)) {
      try { appeals = JSON.parse(fs.readFileSync(appealsPath, 'utf8') || '[]'); } catch (e) { appeals = []; }
    }

    const entry = {
      id: Date.now().toString(),
      userId,
      email: req.user.email || '',
      message,
      status: 'under_review',
      createdAt: new Date().toISOString(),
      reviewedBy: null,
      reviewedAt: null
    };

    appeals.unshift(entry);
    fs.writeFileSync(appealsPath, JSON.stringify(appeals, null, 2));
    
    // Also update user record in MongoDB
    try {
      const user = await User.findOne({ firebaseUid: userId });
      if (user) {
        user.suspendAppeal = message;
        user.suspendAppealStatus = 'pending';
        user.suspendAppealDate = new Date();
        await user.save();
      }
    } catch (e) { console.error('Failed to update user appeal in MongoDB', e); }
    
    return res.json({ success: true, message: 'Your appeal has been submitted and is under review. Our team will review it shortly.' });
  } catch (error) {
    console.error('suspend-appeal error', error);
    return res.status(500).json({ error: 'Failed to submit appeal' });
  }
});

module.exports = router;
