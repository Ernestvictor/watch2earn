const express = require('express');
const router = express.Router();
const User = require('../models/users');
const Earning = require('../models/earning');
const Message = require('../models/messeges');
const History = require('../models/history');
const { payReferralCommission } = require('../lib/referralHelpers');

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

    // pay referral commission (10%) to referrer if any
    try { await payReferralCommission(user, result.userAmount, 'ad'); } catch (e) { console.warn('Referral commission (ad) failed:', e && e.message); }

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

    // pay referral commission (10%) to referrer if any
    try { await payReferralCommission(user, OFFER_REWARD, 'offer'); } catch (e) { console.warn('Referral commission (offer) failed:', e && e.message); }

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