const express = require('express');
const router = express.Router();
const { db } = require('../config/firebaseAdmin');
const verifyToken = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { getRate } = require('../config/exchange');

// Mongoose models
const User = require('../models/users');
const Earning = require('../models/earning');
const Message = require('../models/messeges');

// -------------------- PROFILE --------------------
// GET user profile — read live balances from MongoDB User model
router.get('/profile', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;

  try {
    // Fetch user from MongoDB
    const user = await User.findOne({ $or: [{ firebaseUid: userId }, { uid: userId }, { id: userId }] });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get earnings by type from MongoDB Earning collection
    const allEarnings = await Earning.find({ $or: [{ firebaseUid: userId }, { userId: user._id }] });
    
    const adsEarnings = allEarnings
      .filter(e => (e.type || '').toLowerCase().includes('ad'))
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    
    const gameEarnings = allEarnings
      .filter(e => (e.type || '').toLowerCase().includes('game'))
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    
    const surveyEarnings = allEarnings
      .filter(e => (e.type || '').toLowerCase().includes('survey'))
      .reduce((s, e) => s + Number(e.amount || 0), 0);
    
    const referralEarnings = allEarnings
      .filter(e => (e.type || '').toLowerCase().includes('referral') || (e.type || '').toLowerCase().includes('commission'))
      .reduce((s, e) => s + Number(e.amount || 0), 0);

    // Exchange rate for USD conversion (from centralized config)
    let exchangeRate;
    try { exchangeRate = getRate(); } catch (e) { console.error('Exchange rate error:', e.message); return res.status(500).json({ error: 'Server misconfiguration: exchange rate' }); }
    
    // Use wallet as the live balance
    const balanceNaira = Number(user.wallet || user.balance || 0);
    const balanceUsd = (balanceNaira / exchangeRate).toFixed(6);
    
    const adsEarnUsd = (adsEarnings / exchangeRate).toFixed(6);
    const gameEarnUsd = (gameEarnings / exchangeRate).toFixed(6);
    const surveyEarnUsd = (surveyEarnings / exchangeRate).toFixed(6);
    const refEarnUsd = (referralEarnings / exchangeRate).toFixed(6);

    return res.json({
      balanceNaira,
      balanceUsd: +balanceUsd,
      adsEarn: +adsEarnUsd,
      gameEarn: +gameEarnUsd,
      surveyEarn: +surveyEarnUsd,
      refEarn: +refEarnUsd,
      referralCount: user.referralCount || 0,
      referralEarn: user.referralEarn || 0,
      invitedCount: user.invitedCount || 0,
      displayName: user.displayName || user.username || 'User',
      email: user.email
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
        // Store appeal in MongoDB (new `Appeal` collection)
        const Appeal = require('../models/appeal');
        const entry = await Appeal.create({
          userId,
          firebaseUid: userId,
          email: req.user.email || null,
          message,
          status: 'under_review'
        });
    
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
