const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Earning = require('../models/earning');
const Message = require('../models/messeges');

router.post('/watch-ad', async (req, res) => {
  try {
    const { firebaseUid, amount = 10 } = req.body;

    // 1. Get user
    const user = await User.findOne({ firebaseUid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isBanned) return res.status(403).json({ error: 'User is banned' });

    // 2. AUTO CREATE EARNING RECORD
    await Earning.create({
      userId: user._id,
      firebaseUid,
      amount,
      type: 'ad_watch',
      description: `Watched ad and earned ₦${amount}`
    });

    // 3. AUTO CREATE MESSAGE
    await Message.create({
      userId: user._id,
      firebaseUid,
      message: `You earned ₦${amount} for watching an ad`,
      type: 'earning'
    });

    // 4. UPDATE WALLET
    user.wallet += amount;
    await user.save();

    res.json({ success: true, newWallet: user.wallet });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;