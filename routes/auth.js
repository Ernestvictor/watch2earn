const express = require('express');
const router = express.Router();
const User = require('../models/User');

// REGISTER route
router.post('/register', async (req, res) => {
  try {
    const { firebaseUid, email, username, displayName, referredBy } = req.body || {};

    if (!firebaseUid || !email) {
      return res.status(400).json({ error: 'firebaseUid and email are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const safeName = (username || displayName || normalizedEmail.split('@')[0] || 'User').trim();

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
        referredBy: referredBy || null
      });
    } else {
      user.email = normalizedEmail;
      user.username = safeName;
      user.displayName = safeName;
      if (referredBy && !user.referredBy) user.referredBy = referredBy;
      await user.save();
    }

    return res.json({ success: true, user });
  } catch (error) {
    console.error('Auth register error:', error);
    return res.status(500).json({ error: error.message || 'Failed to create MongoDB user record' });
  }
});

// LOGIN placeholder (handled client-side with Firebase)
router.post('/login', (req, res) => {
  res.json({ message: 'Login handled on frontend with Firebase' });
});

// LOGOUT placeholder (handled client-side with Firebase)
router.post('/logout', (req, res) => {
  res.json({ message: 'Logout handled on frontend with Firebase' });
});

module.exports = router;
