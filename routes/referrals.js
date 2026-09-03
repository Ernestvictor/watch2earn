const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');

// =======================
// Import Models (from models/)
// =======================
const User = require('../models/users');
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

// =======================
// Referral Commission Logic (10% per earning)
// =======================
async function payReferralCommission(user, amount, source = 'ad') {
  if (!user.referredBy) return; // User has no referrer

  try {
    const commissionRate = 0.10;
    const commission = amount * commissionRate;
    const referrer = await User.findById(user.referredBy);
    
    if (!referrer) return; // Referrer not found

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      referrer.wallet = Number(referrer.wallet || 0) + commission;
      referrer.totalEarned = Number(referrer.totalEarned || 0) + commission;

      const earning = await createRewardLog({
        user: referrer,
        firebaseUid: referrer.firebaseUid,
        type: 'referral',
        sourceId: `referral-${Date.now()}`,
        amount: commission,
        description: `10% commission from ${user.username || user.email}'s ${source} earning`,
        metadata: {
          source,
          referredUserId: user._id.toString(),
          referrerUserId: referrer._id.toString()
        }
      });

      await referrer.save({ session });

      await session.commitTransaction();
      console.log(`✅ Referral commission: ₦${(commission * 1500).toFixed(2)} to ${referrer.email}`);
      return earning;
    } catch (err) {
      await session.abortTransaction();
      console.error("❌ Referral commission transaction error:", err);
      throw err;
    } finally {
      session.endSession();
    }
  } catch (err) {
    console.error("❌ Referral commission error:", err);
  }
}

// =======================
// API Routes
// =======================

// POST /api/referrals/watch-ad - Credit earner & pay referral commission
router.post('/watch-ad', async (req, res) => {
  try {
    const { firebaseUid, amount = 0.005 } = req.body;
    
    if (!firebaseUid) {
      return res.status(400).json({ error: 'firebaseUid required' });
    }

    const user = await User.findOne({ firebaseUid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const earning = await createRewardLog({
      user,
      firebaseUid,
      type: 'ad_watch',
      sourceId: `ad-${Date.now()}`,
      amount,
      description: 'Watched advertisement',
      metadata: {
        source: 'ad'
      }
    });

    user.wallet = (user.wallet || 0) + amount;
    user.totalEarned = (user.totalEarned || 0) + amount;
    await user.save();

    await payReferralCommission(user, amount, 'ad');

    return res.json({ 
      success: true, 
      newWallet: user.wallet,
      earned: amount
    });
  } catch (error) {
    console.error('❌ /watch-ad error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/referrals/summary - Get referral summary for authenticated user
router.get('/summary', verifyToken, async (req, res) => {
  try {
    const firebaseUid = req.user.uid || req.user.id;
    
    // Find user
    const user = await User.findOne({ firebaseUid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get all referral earnings for this user
    const referralEarnings = await Earning.find({
      userId: user._id,
      type: 'referral'
    });

    const totalReferralUsd = referralEarnings.reduce((sum, e) => sum + (e.amount || 0), 0);
    const totalReferralNaira = totalReferralUsd * 1500;

    // Get count of referred users
    const referredUsers = await User.find({ referredBy: user._id });
    const countInvited = referredUsers.length;

    return res.json({
      success: true,
      totalReferralUsd: Number(totalReferralUsd.toFixed(4)),
      totalReferralNaira: Math.round(totalReferralNaira),
      countInvited,
      earnings: referralEarnings.length
    });
  } catch (err) {
    console.error('❌ /summary error:', err);
    return res.status(500).json({ error: 'Failed to load referral summary' });
  }
});

// GET /api/referrals - Get detailed referral list with referred users
router.get('/', verifyToken, async (req, res) => {
  try {
    const firebaseUid = req.user.uid || req.user.id;

    // Find user
    const user = await User.findOne({ firebaseUid });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get all referred users
    const referredUsers = await User.find({ referredBy: user._id });

    // Calculate earnings for each referred user
    const referralMap = {};
    referredUsers.forEach(refUser => {
      const uid = refUser._id.toString();
      referralMap[uid] = {
        id: uid,
        name: refUser.username || refUser.email.split('@')[0],
        email: refUser.email,
        totalUsd: 0,
        totalNaira: 0,
        joined: refUser.createdAt || new Date()
      };
    });

    // Get all referral commissions
    const referralEarnings = await Earning.find({
      userId: user._id,
      type: 'referral'
    });

    let totalReferralUsd = 0;
    referralEarnings.forEach(earning => {
      totalReferralUsd += earning.amount || 0;
    });

    const referrals = Object.values(referralMap);
    const countInvited = referrals.length;
    const avgEarningPerReferral = countInvited > 0 ? totalReferralUsd / countInvited : 0;

    referrals.forEach(ref => {
      ref.totalUsd = avgEarningPerReferral;
      ref.totalNaira = Math.round(avgEarningPerReferral * 1500);
    });

    const totals = {
      totalReferralUsd: Number(totalReferralUsd.toFixed(4)),
      totalReferralNaira: Math.round(totalReferralUsd * 1500),
      countInvited,
      totalEarnings: referralEarnings.length
    };

    return res.json({ 
      success: true,
      referrals, 
      totals 
    });
  } catch (err) {
    console.error('❌ / error:', err);
    return res.status(500).json({ error: 'Failed to load referrals' });
  }
});

// POST /api/referrals/update-referrer - Update referrer when new user signs up
router.post('/update-referrer', async (req, res) => {
  try {
    const { referrerId, newUserId } = req.body;
    if (!referrerId || !newUserId) {
      return res.status(400).json({ error: 'referrerId and newUserId required' });
    }

    const referrer = await User.findOne({ firebaseUid: referrerId });
    const newUser = await User.findOne({ firebaseUid: newUserId });

    if (!referrer || !newUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update new user's referredBy field
    newUser.referredBy = referrer._id;
    await newUser.save();

    return res.json({ 
      success: true, 
      message: 'Referrer updated successfully',
      referrerEmail: referrer.email,
      newUserEmail: newUser.email
    });
  } catch (err) {
    console.error('❌ /update-referrer error:', err);
    return res.status(500).json({ error: 'Failed to update referrer' });
  }
});

module.exports = router;
