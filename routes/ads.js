const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/users');
const Earning = require('../models/earning');
const History = require('../models/history');
const Message = require('../models/messeges');
const mongoNative = require('../mongodb');
const router = express.Router();
const auth = require('../middleware/auth');
const verifyToken = require('../middleware/auth');

function isMongooseReady() {
  try { return mongoose && mongoose.connection && mongoose.connection.readyState === 1; } catch (e) { return false; }
}

// public: list ads from MongoDB
router.get('/', async (req, res) => {
  try {
    const adsCollection = mongoNative.getCollection('ads');
    const ads = await adsCollection.find({}).sort({ createdAt: -1 }).toArray();
    res.json(ads || []);
  } catch (err) {
    console.error('Error fetching ads:', err);
    res.json([]);
  }
});

// admin: create ad in MongoDB
router.post('/', auth, async (req, res) => {
  try {
    const { id, title, seconds, type } = req.body;
    const adsCollection = mongoNative.getCollection('ads');
    const ad = { 
      id: id || ('ad_' + Date.now()), 
      title: title || 'Untitled', 
      seconds: Number(seconds) || 15, 
      type: type || 'ad',
      createdAt: new Date()
    };
    const result = await adsCollection.insertOne(ad);
    res.json({ ...ad, _id: result.insertedId });
  } catch (err) {
    console.error('Error creating ad:', err);
    res.status(500).json({ error: 'Failed to create ad' });
  }
});

// admin: update ad in MongoDB
router.put('/:id', auth, async (req, res) => {
  try {
    const adsCollection = mongoNative.getCollection('ads');
    const result = await adsCollection.findOneAndUpdate(
      { id: req.params.id },
      { $set: { ...req.body, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!result.value) return res.status(404).json({ error: 'Ad not found' });
    res.json(result.value);
  } catch (err) {
    console.error('Error updating ad:', err);
    res.status(500).json({ error: 'Failed to update ad' });
  }
});

// admin: delete ad from MongoDB
router.delete('/:id', auth, async (req, res) => {
  try {
    const adsCollection = mongoNative.getCollection('ads');
    const result = await adsCollection.deleteOne({ id: req.params.id });
    res.json({ deleted: result.deletedCount });
  } catch (err) {
    console.error('Error deleting ad:', err);
    res.status(500).json({ error: 'Failed to delete ad' });
  }
});

// POST /api/ads/watch - Watch an ad and earn money based on duration (MongoDB only)
router.post('/watch', verifyToken, async (req, res) => {
  try {
    const { adDuration, adId } = req.body;
    const userId = req.user.uid || req.user.id;
    const email = req.user.email;
    
    if (!adDuration || typeof adDuration !== 'number') {
      return res.status(400).json({ error: 'Invalid ad duration' });
    }

    if (!adId || typeof adId !== 'string') {
      return res.status(400).json({ error: 'Ad ID is required' });
    }

    // Check daily ad limit (5 ads per day)
    const txColl = mongoNative.getTransactionsCollection();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaysAds = await txColl.find({
      userId,
      type: 'ad_watch',
      createdAt: { $gte: today }
    }).toArray();

    if (todaysAds.length >= 5) {
      return res.status(403).json({
        error: 'Daily ad limit reached (5/day)',
        message: 'You can watch 5 ads per day. Limit resets at 12:00 AM tomorrow',
        adsToday: 5,
        remaining: 0
      });
    }

    // Check if ad is 15+ seconds to approve payment
    let payment = 0; // in NGN
    if (adDuration >= 15) {
      payment = 2.00; // 2.00 NGN for watching 15+ second ad
    } else {
      return res.status(400).json({
        error: 'Ad too short',
        message: 'Video must be at least 15 seconds for payment',
        minDuration: 15,
        yourDuration: adDuration
      });
    }

    // Convert to USD
    const paymentUsd = +(payment / 1500).toFixed(6);

    // Record the ad watch transaction
    const adTx = {
      userId,
      email: email || null,
      adId,
      type: 'ad_watch',
      source: 'video_ad',
      title: `Watched ${adDuration}s ad`,
      amountUsd: paymentUsd,
      amountNaira: payment,
      adDuration,
      createdAt: new Date()
    };

    await txColl.insertOne(adTx);

    // Update user wallet and balance in MongoDB
    const user = await User.findOne({ $or: [{ firebaseUid: userId }, { email }] });
    if (user) {
      user.balance = (user.balance || 0) + paymentUsd;
      user.wallet = (user.wallet || 0) + payment;
      user.totalEarned = (user.totalEarned || 0) + paymentUsd;
      user.lastAdShowTime = new Date();
      await user.save();

      // Record earning
      if (Earning) {
        await Earning.create({ userId: user._id, firebaseUid: userId, amount: payment, type: 'ad_watch', description: `Watched ad ${adId}` });
      }
      if (History) {
        await History.create({ userId: user._id, firebaseUid: userId, type: 'ad_watch', amount: payment, description: `Watched ad ${adId}`, referenceId: adTx._id, metadata: { adId } });
      }

      // If user has a referrer, pay commission
      if (user.referredBy) {
        const referrer = await User.findById(user.referredBy);
        if (referrer) {
          const commission = +(payment * 0.1).toFixed(2);
          const commissionUsd = +(paymentUsd * 0.1).toFixed(6);
          
          referrer.balance = (referrer.balance || 0) + commissionUsd;
          referrer.wallet = (referrer.wallet || 0) + commission;
          referrer.totalEarned = (referrer.totalEarned || 0) + commissionUsd;
          await referrer.save();

          // Record referral transaction
          const refTx = {
            userId: referrer._id,
            email: referrer.email,
            type: 'referral_commission',
            source: 'ad_referral',
            title: `Referral commission from user ad watch`,
            amountUsd: commissionUsd,
            amountNaira: commission,
            referredUserId: userId,
            createdAt: new Date()
          };
          await txColl.insertOne(refTx);

          if (Earning) {
            await Earning.create({ userId: referrer._id, firebaseUid: referrer.firebaseUid, amount: commission, type: 'referral_commission', description: `Commission from ${userId}` });
          }
          if (Message) {
            await Message.create({ userId: referrer._id, firebaseUid: referrer.firebaseUid, message: `You earned ₦${commission} referral commission`, type: 'earning' });
          }
        }
      }
    }

    res.json({
      success: true,
      message: 'Ad watched successfully',
      payment,
      paymentUsd,
      adsToday: todaysAds.length + 1,
      remaining: Math.max(5 - (todaysAds.length + 1), 0),
      resetTime: '12:00 AM'
    });
  } catch (err) {
    console.error('Error in POST /watch:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
