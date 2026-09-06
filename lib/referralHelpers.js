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
    const commissionRate = Number(process.env.REFERRAL_RATE || 0.10);
    const commission = amount * commissionRate;
    const referrerUid = user.referredBy; // Firebase UID stored in User.referredBy

    const referrer = await User.findOne({ firebaseUid: referrerUid });
    if (!referrer) return console.warn(`⚠️ Referrer not found for UID: ${referrerUid}`);

    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      // Update referrer wallet and stats
      referrer.wallet = Number(referrer.wallet || 0) + commission;
      referrer.totalEarned = Number(referrer.totalEarned || 0) + commission;
      referrer.referralEarn = Number(referrer.referralEarn || 0) + commission;
      await referrer.save({ session });

      // Create reward log
      await createRewardLog({
        user: referrer,
        firebaseUid: referrer.firebaseUid,
        type: 'referral',
        sourceId: `referral-${Date.now()}`,
        amount: commission,
        description: `Commission from ${user.username || user.email}'s ${source} earning`,
        metadata: {
          source,
          referredUserId: user._id.toString(),
          referrerUserId: referrer._id.toString()
        }
      });

      // Update or create Referral document
      await Referral.findOneAndUpdate(
        { referredByUid: referrerUid, referredUid: user.firebaseUid },
        {
          $inc: { commission: commission, totalCommissions: commission },
          $push: {
            earnings: {
              type: source,
              amount,
              commission,
              date: new Date(),
              transactionId: `ref-${Date.now()}`
            }
          },
          $set: { updatedAt: new Date() }
        },
        { upsert: true, session }
      );

      await session.commitTransaction();
      console.log(`✅ Referral commission: ₦${(commission * 1500).toFixed(2)} from ${source} to ${referrer.email}`);
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
