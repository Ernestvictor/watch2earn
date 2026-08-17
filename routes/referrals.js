const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');

// =======================
// Import Models (from models/)
// =======================
const User = require('../models/User');
const Earning = require('../models/earning');
const Message = require('../models/messeges');

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
      // Record earning for referrer
      const earning = await Earning.create([{
        userId: referrer._id,
        firebaseUid: referrer.firebaseUid,
        amount: commission,
        type: 'referral',
        description: `10% commission from ${user.username || user.email}'s ${source} earning`,
      }], { session });

      // Notify referrer
      await Message.create([{
        userId: referrer._id,
        firebaseUid: referrer.firebaseUid,
        message: `You earned ₦${(commission * 1500).toFixed(2)} commission from a referral`,
        type: 'earning',
        read: false
      }], { session });

      // Update referrer wallet
      referrer.wallet = (referrer.wallet || 0) + commission;
      await referrer.save({ session });

      await session.commitTransaction();
      console.log(`✅ Referral commission: ₦${(commission * 1500).toFixed(2)} to ${referrer.email}`);
    } catch (err) {
      await session.abortTransaction();
      console.error("❌ Referral commission transaction error:", err);
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

    // Record earning
    const earning = await Earning.create({
      userId: user._id,
      firebaseUid,
      amount,
      type: 'ad_watch',
      description: 'Watched advertisement'
    });

    // Notify user
    await Message.create({
      userId: user._id,
      firebaseUid,
      message: `You earned $${amount.toFixed(4)} from watching an ad`,
      type: 'earning',
      read: false
    });

    // Update user wallet
    user.wallet = (user.wallet || 0) + amount;
    user.totalEarned = (user.totalEarned || 0) + amount;
    await user.save();

    // Pay referral commission if applicable
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

    // Since we don't track which referral earning is from which user in legacy data,
    // we'll distribute evenly or track by individual user earnings from jobs
    let totalReferralUsd = 0;
    referralEarnings.forEach(earning => {
      totalReferralUsd += earning.amount || 0;
    });

    const referrals = Object.values(referralMap);
    const countInvited = referrals.length;
    const avgEarningPerReferral = countInvited > 0 ? totalReferralUsd / countInvited : 0;

    // Distribute earnings evenly among referred users (can be customized)
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
    console.error('❌ /referrals error:', err);
    return res.status(500).json({ error: 'Failed to load referrals' });
  }
});

// =======================
// Exports
// =======================
module.exports = router;
module.exports.payReferralCommission = payReferralCommission;
