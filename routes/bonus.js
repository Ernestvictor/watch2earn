const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const User = require('../models/users');
const Earning = require('../models/earning');
const Message = require('../models/messeges');
const History = require('../models/history');
const mongoNative = require('../mongodb');

function isMongooseReady() {
  try {
    return mongoose && mongoose.connection && mongoose.connection.readyState === 1;
  } catch (e) { return false; }
}

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

// GET /api/bonus/available - Get all available bonuses for current user
router.get('/available', verifyToken, async (req, res) => {
  try {
    const firebaseUid = req.user.uid || req.user.id;
    let bonuses = [];

    if (!isMongooseReady()) return res.status(503).json({ error: 'MongoDB is required for bonuses' });
    try {
      const bonusCol = mongoNative.getCollection('bonuses');
      bonuses = await bonusCol.find({
        $or: [
          { targetUserId: firebaseUid, claimed: false },
          { targetType: 'all', claimed: { $ne: true } }
        ]
      }).toArray();
    } catch (e) {
      console.error('Failed to fetch bonuses from mongo:', e && e.message);
      return res.status(500).json({ error: 'Failed to fetch bonuses' });
    }

    // Enrich with claimed status
    bonuses = bonuses.map(b => ({
      ...b,
      canClaim: !b.claimed || b.claimed === false
    }));

    res.json({ bonuses, count: bonuses.length });
  } catch (error) {
    console.error('Get available bonuses error:', error);
    res.status(500).json({ error: 'Failed to fetch available bonuses' });
  }
});

// POST /api/bonus/claim/:id - Claim a specific bonus and add to wallet
router.post('/claim/:id', verifyToken, async (req, res) => {
  try {
    const firebaseUid = req.user.uid || req.user.id;
    const bonusId = req.params.id;

    if (!bonusId) {
      return res.status(400).json({ error: 'Bonus ID is required' });
    }

    if (!isMongooseReady()) return res.status(503).json({ error: 'MongoDB is required for claiming bonuses' });

    let bonus = null;
    try {
      const bonusCol = mongoNative.getCollection('bonuses');
      bonus = await bonusCol.findOne({ $or: [{ id: bonusId }, { _id: bonusId }] });
    } catch (e) {
      console.error('Failed to lookup bonus in mongo:', e && e.message);
      return res.status(500).json({ error: 'Failed to lookup bonus' });
    }

    if (!bonus) return res.status(404).json({ error: 'Bonus not found' });

    if (bonus.claimed) {
      return res.status(400).json({ error: 'This bonus has already been claimed' });
    }

    if (bonus.targetType === 'specific' && bonus.targetUserId !== firebaseUid) {
      return res.status(403).json({ error: 'This bonus is not for you' });
    }

    // Fetch user using Mongoose (not file fallback)
    let user = await User.findOne({ $or: [{ firebaseUid }, { uid: firebaseUid }, { id: firebaseUid }, { _id: firebaseUid }] });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const amountUsd = Number(bonus.amountUsd || bonus.amount || 0);
    if (amountUsd <= 0) {
      return res.status(400).json({ error: 'Invalid bonus amount' });
    }

    // Use environment variable for USD to Naira conversion rate, default to 1500
    const exchangeRate = Number(process.env.USD_TO_NAIRA_RATE || 1500);
    const amountNaira = Math.round(amountUsd * exchangeRate);

    // Update user wallet using MongoDB with atomic operation - ensures balance is saved
    user = await User.findOneAndUpdate(
      { _id: user._id },
      {
        $inc: { wallet: amountNaira, balance: amountNaira, totalEarned: amountNaira }
      },
      { new: true }
    );
    if (!user) return res.status(500).json({ error: 'Failed to update balance' });

    // Create logs for bonus claim
    await Earning.create({
      userId: user._id,
      firebaseUid,
      amount: amountNaira,
      type: 'bonus',
      description: bonus.description || 'Admin bonus'
    });

    await History.create({
      userId: user._id,
      firebaseUid,
      type: 'bonus',
      amount: amountNaira,
      description: bonus.description || 'Admin bonus claimed',
      referenceId: bonusId,
      status: 'success',
      metadata: { bonusId, claimedAt: new Date().toISOString() }
    });

    await Message.create({
      userId: user._id,
      firebaseUid,
      message: bonus.description || `You claimed a bonus of ₦${amountNaira.toLocaleString()}!`,
      type: 'earning',
      read: false
    });

    // Mark bonus as claimed in MongoDB bonuses collection (MUST AWAIT to ensure it's marked before response)
    try {
      const bonusCol = mongoNative.getCollection('bonuses');
      const updateResult = await bonusCol.updateOne(
        { $or: [{ id: bonusId }, { _id: bonusId }] },
        { $set: { claimed: true, claimedBy: firebaseUid, claimedAt: new Date().toISOString() }, $currentDate: { updatedAt: true } }
      );
      if (updateResult.matchedCount === 0) {
        console.warn('Bonus marked as claimed but update may have failed:', bonusId);
      }
    } catch (e) {
      console.error('Failed to mark bonus as claimed in MongoDB:', e && e.message);
      // Don't fail the response, the wallet was already updated
    }

    // Fetch fresh user data to return updated balance
    const refreshedUser = await User.findOne({ _id: user._id }).lean();
    const refreshedBalance = Number(refreshedUser?.balance || 0);

    res.json({
      success: true,
      message: `Bonus claimed successfully!`,
      amount: amountUsd,
      amountNaira,
      newWallet: refreshedBalance,
      newWalletUsd: refreshedBalance / 1500,
      bonus: bonus.description
    });
  } catch (error) {
    console.error('Claim bonus error:', error);
    res.status(500).json({ error: error.message || 'Failed to claim bonus' });
  }
});

router.post('/claim-bonus', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { firebaseUid } = req.body;
    const user = await User.findOne({ firebaseUid }).session(session);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Use environment variable, default to 50 if not set
    const BONUS_AMOUNT = Number(process.env.DAILY_BONUS_AMOUNT || 50);
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
