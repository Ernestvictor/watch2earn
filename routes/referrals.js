const mongoose = require('mongoose');
const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');

// =======================
// Schemas & Models
// =======================
const earningSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  firebaseUid: String,
  amount: Number,
  type: { type: String, default: 'referral' },
  description: String,
  referredUserId: mongoose.Schema.Types.ObjectId,
  source: String,
  date: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId,
  firebaseUid: String,
  message: String,
  type: { type: String, default: 'earning' },
  date: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  username: String,
  email: String,
  firebaseUid: String,
  wallet: { type: Number, default: 0 },
  referredBy: mongoose.Schema.Types.ObjectId
});

const Earning = mongoose.models.Earning || mongoose.model('Earning', earningSchema);
const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
const User = mongoose.models.User || mongoose.model('User', userSchema);

// =======================
// Referral Commission Logic
// =======================
async function payReferralCommission(user, amount, source) {
  if (!user.referredBy) return;

  const commissionRate = 0.10;
  const commission = amount * commissionRate;
  const referrer = await User.findById(user.referredBy);
  if (!referrer) return;

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    await Earning.create([{
      userId: referrer._id,
      firebaseUid: referrer.firebaseUid,
      amount: commission,
      type: 'referral',
      description: `10% commission from ${user.username}'s ${source} earning`,
      referredUserId: user._id,
      source
    }], { session });

    await Message.create([{
      userId: referrer._id,
      firebaseUid: referrer.firebaseUid,
      message: `You got ₦${commission.toFixed(2)} commission from ${user.username}`,
      type: 'earning'
    }], { session });

    referrer.wallet += commission;
    await referrer.save({ session });

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    console.error("Referral commission error:", err);
  } finally {
    session.endSession();
  }
}

// =======================
// Routes
// =======================

// POST /api/earnings/watch-ad
router.post('/watch-ad', async (req, res) => {
  try {
    const { firebaseUid, amount = 10 } = req.body;
    const user = await User.findOne({ firebaseUid });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await Promise.all([
      Earning.create({ userId: user._id, firebaseUid, amount, type: 'ad_watch', description: 'Watched ad' }),
      Message.create({ userId: user._id, firebaseUid, message: `You earned ₦${amount}`, type: 'earning' })
    ]);

    user.wallet += amount;
    await payReferralCommission(user, amount, 'ad');
    await user.save();

    res.json({ success: true, newWallet: user.wallet });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/referrals
router.get('/referrals', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;

  try {
    const referralTxs = await Earning.find({ type: 'referral', userId });

    const map = {};
    referralTxs.forEach(t => {
      const rid = t.referredUserId?.toString() || 'unknown';
      if (!map[rid]) map[rid] = { id: rid, totalNaira: 0, txs: [] };
      map[rid].totalNaira += Number(t.amount || 0);
      map[rid].txs.push(t);
    });

    const result = await Promise.all(Object.values(map).map(async item => {
      const found = await User.findById(item.id);
      return {
        ...item,
        name: found?.username || found?.email?.split('@')[0] || 'Unknown',
        email: found?.email || null,
        firstSeen: item.txs.length ? item.txs[item.txs.length - 1].date : null
      };
    }));

    const totals = {
      totalReferralNaira: result.reduce((s, r) => s + (r.totalNaira || 0), 0),
      countInvited: result.length
    };

    res.json({ referrals: result, totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load referrals' });
  }
});

module.exports = router;
module.exports.router = router;
module.exports.payReferralCommission = payReferralCommission;
module.exports.User = User;
module.exports.Earning = Earning;
module.exports.Message = Message;
