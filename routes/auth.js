const express = require('express');
const router = express.Router();
const User = require('../models/User');

// REGISTER route
router.post('/register', async (req, res) => {
  try {
    const { firebaseUid, email, username } = req.body;

    let user = await User.findOne({ firebaseUid });

    if (!user) {
      // AUTO CREATE if not exist
      user = await User.create({
        firebaseUid,
        email,
        username,
        wallet: 0
      });
    }

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
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
