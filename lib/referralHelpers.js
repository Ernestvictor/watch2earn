const mongoose = require('mongoose');
const User = require('../models/users');
const Earning = require('../models/earning');
const History = require('../models/history');
const Message = require('../models/messeges');

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

// Pay 10% commission to referrer if exists
async function payReferralCommission(user, amount, source = 'ad') {
  if (!user || !user.referredBy) return;
  try {
    const commissionRate = Number(process.env.REFERRAL_RATE || 0.10);
    const commission = amount * commissionRate;
    const referrer = await User.findById(user.referredBy);
    if (!referrer) return;

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      referrer.wallet = Number(referrer.wallet || 0) + commission;
      referrer.totalEarned = Number(referrer.totalEarned || 0) + commission;

      await createRewardLog({
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
      return true;
    } catch (err) {
      await session.abortTransaction();
      console.error('❌ Referral commission transaction error:', err && err.message);
      throw err;
    } finally {
      session.endSession();
    }
  } catch (err) {
    console.error('❌ Referral commission error:', err && err.message);
  }
}

module.exports = {
  createRewardLog,
  payReferralCommission
};
