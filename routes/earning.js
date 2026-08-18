const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Earning = require('../models/earning');
const Message = require('../models/messeges');
const History = require('../models/history');

async function createEarningLog({ user, firebaseUid, type, amount, description }) {
  return Earning.create({
    userId: user._id,
    firebaseUid,
    amount,
    type,
    description: description || `Earned from ${type}`
  });
}

async function createHistoryLog({ user, firebaseUid, type, sourceId, amount, description, status = 'success', metadata = {} }) {
  return History.create({
    userId: user._id,
    firebaseUid,
    type,
    amount,
    description: description || `Completed ${type}: +₦${amount}`,
    referenceId: sourceId || null,
    status,
    metadata
  });
}

async function createMessageLog({ user, firebaseUid, message, type = 'earning' }) {
  return Message.create({
    userId: user._id,
    firebaseUid,
    message,
    type,
    read: false
  });
}

async function addEarning({ user, firebaseUid, type, sourceId, networkAmount, description }) {
  const amount = Number(networkAmount || 0);
  const userAmount = amount;
  const platformAmount = 0;

  user.wallet = Number(user.wallet || 0) + userAmount;
  user.totalEarned = Number(user.totalEarned || 0) + userAmount;
  await user.save();

  const earningRecord = await createEarningLog({
    user,
    firebaseUid,
    type,
    amount: userAmount,
    description: description || `Earned from ${type}`
  });

  const historyRecord = await createHistoryLog({
    user,
    firebaseUid,
    type,
    sourceId,
    amount: userAmount,
    description: description || `Completed ${type}: +₦${userAmount}`,
    metadata: {
      sourceId,
      platformAmount,
      balanceAfter: user.wallet
    }
  });

  const messageRecord = await createMessageLog({
    user,
    firebaseUid,
    message: description || `You earned ₦${userAmount} from ${type}`,
    type: 'earning'
  });

  return {
    user,
    earningRecord,
    historyRecord,
    messageRecord,
    userAmount,
    platformAmount,
    newBalance: user.wallet
  };
}

router.post('/watch-ad', async (req, res) => {
  try {
    const { firebaseUid, amount = 10 } = req.body;

    const user = await User.findOne({ firebaseUid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isBanned) return res.status(403).json({ error: 'User is banned' });

    const result = await addEarning({
      user,
      firebaseUid,
      type: 'ad_watch',
      sourceId: `ad-${Date.now()}`,
      networkAmount: amount,
      description: `Watched ad and earned ₦${amount}`
    });

    res.json({ success: true, newWallet: result.newBalance, amount: result.userAmount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/earning/offer-click - Track sponsored offer clicks (15 sec countdown, 2.00 NGN credit)
router.post('/offer-click', async (req, res) => {
  try {
    const { firebaseUid } = req.body;

    if (!firebaseUid) {
      return res.status(400).json({ error: 'firebaseUid required' });
    }

    const user = await User.findOne({ firebaseUid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isBanned) return res.status(403).json({ error: 'User is banned' });

    const OFFER_REWARD = 2.00; // NGN

    const result = await addEarning({
      user,
      firebaseUid,
      type: 'offer_click',
      sourceId: `offer-${Date.now()}`,
      networkAmount: OFFER_REWARD,
      description: `Clicked sponsored offer and earned ₦${OFFER_REWARD}`
    });

    // Also pay referral commission if user has a referrer
    if (user.referredBy) {
      try {
        const referrer = await User.findById(user.referredBy);
        if (referrer) {
          const commission = OFFER_REWARD * 0.10; // 10% commission
          referrer.wallet = Number(referrer.wallet || 0) + commission;
          referrer.totalEarned = Number(referrer.totalEarned || 0) + commission;
          await referrer.save();

          await createRewardLog({
            user: referrer,
            firebaseUid: referrer.firebaseUid,
            type: 'referral',
            sourceId: `referral-offer-${Date.now()}`,
            amount: commission,
            description: `10% commission from ${user.username || user.email}'s offer click`,
            metadata: {
              source: 'offer_referral',
              referredUserId: user._id.toString()
            }
          });

          console.log(`✅ Referral commission: ₦${(commission * 1500).toFixed(2)} to ${referrer.email}`);
        }
      } catch (err) {
        console.warn('Referral commission failed (offer click):', err.message);
      }
    }

    res.json({ 
      success: true, 
      newWallet: result.newBalance, 
      amount: result.userAmount,
      message: 'Offer completed!'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;