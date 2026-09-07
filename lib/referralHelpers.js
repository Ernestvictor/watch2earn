const mongoose = require('mongoose');
const User = require('../models/users');
const Earning = require('../models/earning');
const History = require('../models/history');
const Message = require('../models/messeges');
const Referral = require('../models/referral');

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

// Pay commission to referrer if exists: update referrer wallet, create Referral record, increment referralEarn
async function payReferralCommission(user, amount, source = 'ad') {
  if (!user || !user.referredBy) return;
  try {
    // Delegate commission logic to Referral.addCommission which handles transactions and logging
    const commission = await Referral.addCommission(user.firebaseUid, amount, { source });
    if (commission && commission > 0) {
      console.log(`✅ Referral commission paid: ₦${commission} for referred ${user.firebaseUid}`);
      return true;
    }
    return false;
  } catch (err) {
    console.error('❌ Referral commission error:', err && err.message);
    return false;
  }
}

module.exports = {
  createRewardLog,
  payReferralCommission
};
