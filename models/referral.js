const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referralId: {
    type: String,
    unique: true,
    index: true,
    sparse: true,
    default: function () {
      return `ref_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  },
  referredByUid: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  referredByEmail: {
    type: String,
    default: '',
    trim: true,
    lowercase: true
  },
  referredUid: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  referredEmail: {
    type: String,
    default: '',
    trim: true,
    lowercase: true
  },
  commission: {
    type: Number,
    default: 0,
    min: 0
  },
  totalCommissions: {
    type: Number,
    default: 0,
    min: 0
  },
  // history of commission events for traceability
  earnings: [{
    type: { type: String, default: 'referral' },
    amount: { type: Number, default: 0 }, // original amount that generated a commission
    commission: { type: Number, default: 0 }, // commission paid (rounded)
    source: { type: String, default: '' },
    transactionId: { type: String },
    date: { type: Date, default: Date.now }
  }],
  source: {
    type: String,
    default: 'signup',
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'paid', 'cancelled'],
    default: 'active'
  }
}, { timestamps: true });

referralSchema.index({ referredByUid: 1, referredUid: 1 }, { unique: true });

// Static: addCommission
// - referredUid: the firebase UID of the referred user (the one who triggered the earning)
// - amount: the base amount (in same currency/unit as user balances, e.g. Naira integer)
// - opts: { source } optional metadata
referralSchema.statics.addCommission = async function (referredUid, amount, opts = {}) {
  const Referral = this;
  const mongoose = require('mongoose');
  const User = mongoose.model('User');
  const Earning = mongoose.model('Earning');
  const History = mongoose.model('History');
  const Message = mongoose.model('Message');

  if (!referredUid || !amount) return 0;

  const commissionRate = Number(process.env.REFERRAL_RATE || 0.10);
  // Commission is calculated from the earning itself, not deducted from the user reward.
  const rawCommission = Number(amount) * commissionRate;
  const commission = Number(Math.max(0, rawCommission).toFixed(2));

  // Find referral mapping
  const referral = await Referral.findOne({ referredUid: referredUid });
  if (!referral) return 0;

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // update referral doc
    referral.commission = (referral.commission || 0) + commission;
    referral.totalCommissions = (referral.totalCommissions || 0) + commission;
    referral.earnings = referral.earnings || [];
    const txnId = `ref-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    referral.earnings.push({
      type: opts.source || 'referral',
      amount: Number(amount),
      commission,
      source: opts.source || '',
      transactionId: txnId,
      date: new Date()
    });
    referral.updatedAt = new Date();
    await referral.save({ session });

    // credit referrer user
    const referrer = await User.findOne({ firebaseUid: referral.referredByUid }).session(session);
    if (referrer) {
      // use canonical `balance` field
      referrer.balance = Number(referrer.balance || 0) + commission;
      referrer.totalEarned = Number(referrer.totalEarned || 0) + commission;
      referrer.referralEarn = Number(referrer.referralEarn || 0) + commission;
      await referrer.save({ session });

      // create earning record
      await Earning.create([
        {
          userId: referrer._id,
          firebaseUid: referrer.firebaseUid,
          amount: commission,
          type: 'referral',
          description: `Referral commission from ${referredUid}`
        }
      ], { session });

      // create history
      await History.create([
        {
          userId: referrer._id,
          firebaseUid: referrer.firebaseUid,
          type: 'referral',
          amount: commission,
          description: `Referral commission (₦${commission}) from referred user ${referredUid}`,
          referenceId: txnId,
          status: 'success',
          metadata: { source: opts.source || null, referredUid, transactionId: txnId }
        }
      ], { session });

      // create message/notification
      await Message.create([
        {
          userId: referrer._id,
          firebaseUid: referrer.firebaseUid,
          message: `You earned ₦${commission} as a referral commission.`,
          type: 'earning',
          read: false
        }
      ], { session });
    }

    await session.commitTransaction();
    session.endSession();
    return commission;
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
};

module.exports = mongoose.models.Referral || mongoose.model('Referral', referralSchema);
