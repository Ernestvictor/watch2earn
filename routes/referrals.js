const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');

const User = require('../models/users');
const Referral = require('../models/referral');
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

async function payReferralCommission(user, amount, source = 'ad') {
  if (!user || !user.referredBy) return;

  try {
    const commissionRate = Number(process.env.REFERRAL_RATE || 0.10);
    const commission = Number(amount || 0) * commissionRate;
    const referrer = await User.findOne({ firebaseUid: user.referredBy });
    if (!referrer) return;

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      referrer.wallet = Number(referrer.wallet || 0) + commission;
      referrer.totalEarned = Number(referrer.totalEarned || 0) + commission;
      referrer.referralEarn = Number(referrer.referralEarn || 0) + commission;

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

      await Referral.findOneAndUpdate(
        { referredByUid: user.referredBy, referredUid: user.firebaseUid },
        { $inc: { commission: commission } },
        { new: true }
      );

      await referrer.save({ session });
      await session.commitTransaction();
      return earning;
    } catch (err) {
      await session.abortTransaction();
      console.error('❌ Referral commission transaction error:', err);
      throw err;
    } finally {
      session.endSession();
    }
  } catch (err) {
    console.error('❌ Referral commission error:', err);
  }
}

router.post('/watch-ad', async (req, res) => {
  try {
    const { firebaseUid, amount = 0.005 } = req.body;
    if (!firebaseUid) return res.status(400).json({ error: 'firebaseUid required' });

    const user = await User.findOne({ firebaseUid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const earning = await createRewardLog({
      user,
      firebaseUid,
      type: 'ad_watch',
      sourceId: `ad-${Date.now()}`,
      amount,
      description: 'Watched advertisement',
      metadata: { source: 'ad' }
    });

    user.wallet = (user.wallet || 0) + amount;
    user.totalEarned = (user.totalEarned || 0) + amount;
    await user.save();

    await payReferralCommission(user, amount, 'ad');

    return res.json({ success: true, newWallet: user.wallet, earned: amount });
  } catch (error) {
    console.error('❌ /watch-ad error:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/summary', verifyToken, async (req, res) => {
  try {
    const firebaseUid = req.user.uid || req.user.id;
    const user = await User.findOne({ $or: [{ firebaseUid }, { uid: firebaseUid }, { id: firebaseUid }] });
    if (!user) {
      return res.json({ success: true, totalReferralUsd: 0, totalReferralNaira: 0, countInvited: 0, earnings: 0 });
    }

    const referralDocs = await Referral.find({ referredByUid: firebaseUid }).lean();
    const totalReferralNaira = referralDocs.reduce((sum, doc) => sum + Number(doc.commission || 0), 0);
    const totalReferralUsd = totalReferralNaira / 1500;

    return res.json({
      success: true,
      totalReferralUsd: +totalReferralUsd.toFixed(4),
      totalReferralNaira: Math.round(totalReferralNaira),
      countInvited: referralDocs.length,
      earnings: referralDocs.length
    });
  } catch (err) {
    console.error('❌ /summary error:', err);
    return res.status(500).json({ error: 'Failed to load referral summary' });
  }
});

router.get('/', verifyToken, async (req, res) => {
  try {
    const firebaseUid = req.user.uid || req.user.id;
    const user = await User.findOne({ firebaseUid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Get all referral records for this referrer
    const referralDocs = await Referral.find({ referredByUid: firebaseUid }).lean();
    
    // Build referral list by processing Referral documents (single source of truth)
    const referralMap = {};
    let totalReferralNaira = 0;

    for (const doc of referralDocs) {
      const referredUser = await User.findOne({ firebaseUid: doc.referredUid }).lean();
      
      referralMap[doc.referredUid] = {
        id: doc.referredUid,
        name: referredUser?.username || referredUser?.email?.split('@')[0] || 'User',
        email: doc.referredEmail || referredUser?.email || 'N/A',
        totalUsd: Number((doc.commission || 0) / 1500).toFixed(4),
        totalNaira: Math.round(doc.commission || 0),
        joined: referredUser?.createdAt || new Date(),
        status: doc.status
      };
      
      totalReferralNaira += Number(doc.commission || 0);
    }

    const referrals = Object.values(referralMap);

    return res.json({
      success: true,
      referrals,
      totals: {
        totalReferralUsd: Number((totalReferralNaira / 1500).toFixed(4)),
        totalReferralNaira: Math.round(totalReferralNaira),
        countInvited: referrals.length,
        totalEarnings: referralDocs.reduce((sum, doc) => sum + (doc.earnings?.length || 0), 0)
      }
    });
  } catch (err) {
    console.error('❌ / error:', err);
    return res.status(500).json({ error: 'Failed to load referrals' });
  }
});

router.post('/update-referrer', async (req, res) => {
  try {
    const { referrerId, newUserId } = req.body;
    if (!referrerId || !newUserId) return res.status(400).json({ error: 'referrerId and newUserId required' });

    const referrer = await User.findOne({ firebaseUid: referrerId });
    const newUser = await User.findOne({ firebaseUid: newUserId });

    if (!referrer || !newUser) return res.status(404).json({ error: 'User not found' });

    newUser.referredBy = referrer.firebaseUid;
    await newUser.save();

    await Referral.findOneAndUpdate(
      { referredByUid: referrer.firebaseUid, referredUid: newUser.firebaseUid },
      { $set: { referredByEmail: referrer.email || '', referredEmail: newUser.email || '' } },
      { upsert: true }
    );

    return res.json({ success: true, message: 'Referrer updated successfully', referrerEmail: referrer.email, newUserEmail: newUser.email });
  } catch (err) {
    console.error('❌ /update-referrer error:', err);
    return res.status(500).json({ error: 'Failed to update referrer' });
  }
});

module.exports = router;
