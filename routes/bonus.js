const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const User = require('../models/User');
const Earning = require('../models/earning');
const Message = require('../models/messeges');
const History = require('../models/history');
const fs = require('fs');
const path = require('path');
const mongoNative = require('../mongodb');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BONUSES_PATH = path.join(DATA_DIR, 'bonuses.json');

function isMongooseReady() {
  try {
    return mongoose && mongoose.connection && mongoose.connection.readyState === 1;
  } catch (e) { return false; }
}

function ensureBonusFile() {
  if (!fs.existsSync(BONUSES_PATH)) {
    fs.writeFileSync(BONUSES_PATH, '[]');
  }
}

function readBonuses() {
  ensureBonusFile();
  try { return JSON.parse(fs.readFileSync(BONUSES_PATH, 'utf8') || '[]'); } catch (e) { return []; }
}

function writeBonuses(items) {
  ensureBonusFile();
  fs.writeFileSync(BONUSES_PATH, JSON.stringify(items, null, 2));
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

    if (isMongooseReady()) {
      try {
        const bonusCol = mongoNative.getCollection('bonuses');
        // Get bonuses that haven't been claimed yet and are for this user (or for 'all')
        bonuses = await bonusCol.find({
          $or: [
            { targetUserId: firebaseUid, claimed: false },
            { targetType: 'all', claimed: { $ne: true } }
          ]
        }).toArray();
      } catch (e) {
        // Fall back to file if Mongo fails
        bonuses = readBonuses().filter(b => !b.claimed && (b.targetUserId === firebaseUid || b.targetType === 'all'));
      }
    } else {
      bonuses = readBonuses().filter(b => !b.claimed && (b.targetUserId === firebaseUid || b.targetType === 'all'));
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

    let bonus = null;
    let user = null;
    let userCollection = null;

    // Try MongoDB first
    if (isMongooseReady()) {
      try {
        const bonusCol = mongoNative.getCollection('bonuses');
        bonus = await bonusCol.findOne({ $or: [{ id: bonusId }, { _id: bonusId }] });
        userCollection = mongoNative.getUsersCollection();
      } catch (e) {
        console.warn('Mongo bonus lookup failed, falling back to file:', e.message);
      }
    }

    // Fallback to file-based bonuses
    if (!bonus) {
      const allBonuses = readBonuses();
      bonus = allBonuses.find(b => b.id === bonusId);
    }

    if (!bonus) {
      return res.status(404).json({ error: 'Bonus not found' });
    }

    if (bonus.claimed) {
      return res.status(400).json({ error: 'This bonus has already been claimed' });
    }

    // Check if bonus is for this user (or for all)
    if (bonus.targetType === 'specific' && bonus.targetUserId !== firebaseUid) {
      return res.status(403).json({ error: 'This bonus is not for you' });
    }

    // Get user from Mongoose
    if (isMongooseReady()) {
      user = await User.findOne({ firebaseUid });
    } else {
      // File-based user lookup
      const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8') || '[]');
      user = users.find(u => (u.firebaseUid || u.uid || '').toString() === firebaseUid.toString());
      if (user && !user._id) user._id = user.id || user.uid;
    }

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const amountUsd = Number(bonus.amountUsd || bonus.amount || 0);
    if (amountUsd <= 0) {
      return res.status(400).json({ error: 'Invalid bonus amount' });
    }

    // Update user balance in Mongoose
    if (isMongooseReady()) {
      user.wallet = Number(user.wallet || 0) + amountUsd;
      user.totalEarned = Number(user.totalEarned || 0) + amountUsd;
      await user.save();

      // Create earning record
      await Earning.create({
        userId: user._id,
        firebaseUid,
        amount: amountUsd,
        type: 'bonus',
        description: bonus.description || 'Admin bonus'
      });

      // Create history/notification
      await History.create({
        userId: user._id,
        firebaseUid,
        type: 'bonus',
        amount: amountUsd,
        description: bonus.description || 'Admin bonus claimed',
        referenceId: bonusId,
        status: 'success',
        metadata: { bonusId, claimedAt: new Date().toISOString() }
      });

      // Create notification message
      await Message.create({
        userId: user._id,
        firebaseUid,
        message: bonus.description || `You claimed a bonus of $${amountUsd.toFixed(2)}!`,
        type: 'earning',
        read: false
      });

      // Mark bonus as claimed in MongoDB
      try {
        const bonusCol = mongoNative.getCollection('bonuses');
        await bonusCol.updateOne(
          { $or: [{ id: bonusId }, { _id: bonusId }] },
          { $set: { claimed: true, claimedBy: firebaseUid, claimedAt: new Date().toISOString() } }
        );
      } catch (e) {
        console.warn('Failed to update bonus in Mongo:', e.message);
      }
    }

    // Update file-based data in parallel
    try {
      const allBonuses = readBonuses();
      const idx = allBonuses.findIndex(b => b.id === bonusId);
      if (idx >= 0) {
        allBonuses[idx].claimed = true;
        allBonuses[idx].claimedBy = firebaseUid;
        allBonuses[idx].claimedAt = new Date().toISOString();
        writeBonuses(allBonuses);
      }
    } catch (e) {
      console.warn('Failed to update bonus file:', e.message);
    }

    // Update file-based user balance (if not using Mongoose)
    if (!isMongooseReady()) {
      try {
        const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8') || '[]');
        const userIdx = users.findIndex(u => (u.firebaseUid || u.uid || '').toString() === firebaseUid.toString());
        if (userIdx >= 0) {
          users[userIdx].wallet = Number(users[userIdx].wallet || 0) + amountUsd;
          users[userIdx].totalEarned = Number(users[userIdx].totalEarned || 0) + amountUsd;
          fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));
        }
      } catch (e) {
        console.warn('Failed to update user wallet in file:', e.message);
      }

      // Record transaction
      try {
        const txs = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'transactions.json'), 'utf8') || '[]');
        txs.unshift({
          id: 'bonus_' + Date.now(),
          userId: firebaseUid,
          firebaseUid,
          type: 'bonus',
          amount: amountUsd,
          amountUsd,
          description: bonus.description || 'Admin bonus',
          date: new Date().toISOString()
        });
        fs.writeFileSync(path.join(DATA_DIR, 'transactions.json'), JSON.stringify(txs, null, 2));
      } catch (e) {
        console.warn('Failed to record transaction:', e.message);
      }
    }

    res.json({
      success: true,
      message: `Bonus claimed successfully!`,
      amount: amountUsd,
      newWallet: Number(user.wallet || 0) + amountUsd,
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
