const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const User = require('../models/User');
const Earning = require('../models/earning');
const Message = require('../models/messeges');
const History = require('../models/history');

async function createRewardLog({ user, firebaseUid, type, sourceId, amount, description, metadata = {} }) {
  const earning = await Earning.create({
    userId: user._id,
    firebaseUid,
    amount,
    type,
    description: description || `Earned from ${type}`
  });

  await History.create({
    userId: user._id,
    firebaseUid,
    type,
    amount,
    description: description || `Completed ${type}: +₦${amount}`,
    referenceId: sourceId || earning._id.toString(),
    status: 'success',
    metadata: {
      ...metadata,
      sourceId,
      balanceAfter: Number(user.wallet || 0) + Number(amount || 0)
    }
  });

  await Message.create({
    userId: user._id,
    firebaseUid,
    message: description || `You earned ₦${amount} from ${type}`,
    type: 'earning',
    read: false
  });

  return earning;
}

router.post('/claim-bonus', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { firebaseUid } = req.body;
    const user = await User.findOne({ firebaseUid }).session(session);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const BONUS_AMOUNT = 50;
    const now = new Date();
    if (user.lastBonusClaim && (now - user.lastBonusClaim) < 24 * 60 * 60 * 1000) {
      return res.status(400).json({ error: 'Already claimed today' });
    }

    user.wallet = Number(user.wallet || 0) + BONUS_AMOUNT;
    user.totalEarned = Number(user.totalEarned || 0) + BONUS_AMOUNT;

    await createRewardLog({
      user,
      firebaseUid,
      type: 'bonus',
      sourceId: `bonus-${Date.now()}`,
      amount: BONUS_AMOUNT,
      description: `Daily bonus`,
      metadata: { source: 'daily_bonus' }
    });

    user.lastBonusClaim = now;
    await user.save({ session });

    await session.commitTransaction();
    res.json({ success: true, amount: BONUS_AMOUNT, newWallet: user.wallet });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ error: error.message });
  } finally {
    session.endSession();
  }
});

module.exports = router;
