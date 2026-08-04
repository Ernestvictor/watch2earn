const express = require('express');
const router = express.Router();
const User = require('../models/User');

// GET user profile
router.get('/profile', async (req, res) => {
  try {
    // Find user by Firebase UID (stored in MongoDB)
    const user = await User.findOne({ uid: req.user.uid });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return fields account.html expects
    res.json({
      balanceUsd: user.balanceUsd || 0,
      adsEarn: user.adsEarn || 0,
      gameEarn: user.gameEarn || 0,
      surveyEarn: user.surveyEarn || 0,
      refEarn: user.refEarn || 0,
      invitedCount: user.invitedCount || 0,
      announcement: user.announcement || ''
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;
