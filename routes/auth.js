const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Referral = require('../models/referral');

const mongoose = require('mongoose');
const crypto = require('crypto');

// REGISTER route
router.post('/register', async (req, res) => {
  try {
    const { firebaseUid, email, username, displayName, referredBy } = req.body || {};

    if (!firebaseUid || !email) {
      return res.status(400).json({ error: 'firebaseUid and email are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const safeName = (username || displayName || normalizedEmail.split('@')[0] || 'User').trim();
    const referrerUid = referredBy ? String(referredBy).trim() : null;

    let user = await User.findOne({ firebaseUid });
    if (!user) {
      user = await User.findOne({ email: normalizedEmail });
    }

    if (!user) {
      user = await User.create({
        firebaseUid,
        email: normalizedEmail,
        username: safeName,
        displayName: safeName,
        wallet: 0,
        balance: 0,
        totalEarned: 0,
        referredBy: referrerUid,
        referralId: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      });
    } else {
      user.email = normalizedEmail;
      user.username = safeName;
      user.displayName = safeName;
      if (referrerUid && !user.referredBy) user.referredBy = referrerUid;
      if (!user.referralId) user.referralId = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await user.save();
    }

    if (referrerUid) {
      const referrerUser = await User.findOne({ firebaseUid: referrerUid });
      if (referrerUser) {
        const referralDoc = await Referral.findOne({ referredByUid: referrerUid, referredUid: firebaseUid });
        if (!referralDoc) {
          await Referral.create({
            referralId: user.referralId || `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            referredByUid: referrerUid,
            referredByEmail: referrerUser.email || '',
            referredUid: firebaseUid,
            referredEmail: normalizedEmail,
            commission: 0,
            source: 'signup',
            status: 'active'
          });
        }

        await User.findOneAndUpdate(
          { firebaseUid: referrerUid },
          { $inc: { referralCount: 1 } },
          { new: true }
        );
      }
    }

    return res.json({ success: true, user });
  } catch (error) {
    console.error('Auth register error:', error);
    return res.status(500).json({ error: error.message || 'Failed to create MongoDB user record' });
  }
});

// REGISTER-GUEST: create or update a Mongo user record when Firebase account exists
router.post('/register-guest', async (req, res) => {
  try {
    const { email, username, displayName, referredBy } = req.body || {};
    if (!email) return res.status(400).json({ error: 'email required' });

    const normalizedEmail = String(email).trim().toLowerCase();
    const safeName = (username || displayName || normalizedEmail.split('@')[0] || 'User').trim();
    const referrerUid = referredBy ? String(referredBy).trim() : null;

    // Create a deterministic placeholder firebaseUid so later real uid can replace it
    const placeholder = 'guest:' + crypto.createHash('md5').update(normalizedEmail).digest('hex');

    let user = await User.findOne({ email: normalizedEmail }).catch(() => null);
    if (!user) {
      user = await User.create({
        firebaseUid: placeholder,
        email: normalizedEmail,
        username: safeName,
        displayName: safeName,
        wallet: 0,
        balance: 0,
        totalEarned: 0,
        referredBy: referrerUid,
        referralId: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      });
    } else {
      if (referrerUid && !user.referredBy) user.referredBy = referrerUid;
      if (!user.referralId) user.referralId = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await user.save();
    }

    if (referrerUid) {
      const referrerUser = await User.findOne({ firebaseUid: referrerUid });
      if (referrerUser) {
        const referralDoc = await Referral.findOne({ referredByUid: referrerUid, referredUid: placeholder });
        if (!referralDoc) {
          await Referral.create({
            referralId: user.referralId || `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            referredByUid: referrerUid,
            referredByEmail: referrerUser.email || '',
            referredUid: placeholder,
            referredEmail: normalizedEmail,
            commission: 0,
            source: 'signup',
            status: 'active'
          });
        }

        await User.findOneAndUpdate(
          { firebaseUid: referrerUid },
          { $inc: { referralCount: 1 } },
          { new: true }
        );
      }
    }

    return res.json({ success: true, user, created: !user || user.firebaseUid === placeholder });
  } catch (error) {
    console.error('register-guest error:', error);
    return res.status(500).json({ error: error.message || 'Failed to register guest' });
  }
});

// LOGIN placeholder (handled client-side with Firebase)
router.post('/login', (req, res) => {
  res.json({ message: 'Login handled on frontend with Firebase' });
});

// Public status lookup used by the frontend before redirecting after sign-in
router.post('/status', async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || req.query.email || '').trim().toLowerCase();
    if (!email) {
      return res.json({ status: 'unknown', redirect: null, message: 'Email required' });
    }

    const user = await User.findOne({ email }).lean();
    if (!user) {
      return res.json({ status: 'new', redirect: null, message: 'No account found yet.' });
    }

    if (user.isBanned || user.status === 'banned') {
      return res.json({
        status: 'banned',
        redirect: '/banned.html',
        message: 'This account has been banned for violating the site rules.'
      });
    }

    if (user.isSuspended || user.status === 'suspended') {
      return res.json({
        status: 'suspended',
        redirect: '/suspend.html',
        message: 'You have been suspended for breaking rules'
      });
    }

    return res.json({ status: 'active', redirect: '/home.html' });
  } catch (error) {
    console.error('Auth status error:', error);
    return res.status(500).json({ error: 'Failed to resolve account status' });
  }
});

// LOGOUT placeholder (handled client-side with Firebase)
router.post('/logout', (req, res) => {
  res.json({ message: 'Logout handled on frontend with Firebase' });
});

module.exports = router;
