const express = require('express');
const router = express.Router();
const { db } = require('../config/firebaseAdmin');
const verifyToken = require('../middleware/auth');

// GET user profile
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.user.uid).get();
    const user = userDoc.exists ? userDoc.data() : null;
    const displayName = user?.displayName || req.user.name || req.user.email?.split('@')[0] || 'User';
    const email = user?.email || req.user.email || 'user@email.com';

    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        balanceUsd: 0,
        adsEarn: 0,
        gameEarn: 0,
        surveyEarn: 0,
        refEarn: 0,
        invitedCount: 0,
        announcement: '',
        displayName,
        email
      });
    }

    res.json({
      balanceUsd: user.balanceUsd || 0,
      adsEarn: user.adsEarn || 0,
      gameEarn: user.gameEarn || 0,
      surveyEarn: user.surveyEarn || 0,
      refEarn: user.refEarn || 0,
      invitedCount: user.invitedCount || 0,
      announcement: user.announcement || '',
      displayName,
      email
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;
