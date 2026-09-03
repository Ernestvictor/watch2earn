const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Withdrawal = require('../models/withdrawal');
const verifyToken = require('../middleware/auth');
const User = require('../models/users');
const History = require('../models/history');
const mongoNative = require('../mongodb');

async function createWithdrawalHistory({ firebaseUid, userId, amount, description, status = 'pending', metadata = {} }) {
  try {
    let user = null;
    if (firebaseUid) user = await User.findOne({ firebaseUid }).lean();
    if (!user && userId) user = await User.findById(userId).lean();
    if (!user) return null;

    return await History.create({
      userId: user._id,
      firebaseUid: user.firebaseUid || firebaseUid || null,
      type: 'withdrawal',
      amount: Number(amount || 0),
      description: description || 'Withdrawal activity',
      referenceId: metadata.referenceId || null,
      status,
      metadata: {
        ...metadata,
        source: 'withdrawal'
      }
    });
  } catch (error) {
    console.warn('Withdrawal history log skipped:', error.message);
    return null;
  }
}

function chargeFor(amount) {
  const amountNum = Number(amount || 0);
  return amountNum >= 20000 ? 0 : 500;
}

router.post('/request', verifyToken, async (req, res) => {
  try {
    // Verify MongoDB is required and available
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB is required. Database is unavailable.' });
    }

    const {
      amount,
      method,
      accountId,
      walletType,
      accountType,
      accountName,
      accountNumber,
      bankName,
      cryptoType,
      walletAddress
    } = req.body || {};

    const userId = req.user.uid || req.user.id;
    const amountNum = Number(amount || 0);
    const cd = new Date();
    const today = cd.toISOString().slice(0, 10);

    if (!amountNum || amountNum <= 0) {
      return res.status(400).json({ error: 'Amount must be greater than 0.' });
    }

    // Check daily withdrawal limit using MongoDB
    const todaysCount = await Withdrawal.countDocuments({
      userId,
      date: { $gte: new Date(today), $lt: new Date(cd.getFullYear(), cd.getMonth(), cd.getDate() + 1) }
    });
    
    if (todaysCount >= 3) {
      return res.status(403).json({ error: 'Withdrawal limit reached. You can do only 3 withdrawals per day.' });
    }

    if (method === 'bank' && amountNum < 5500) {
      return res.status(400).json({ error: 'Bank withdrawals start from ₦5,500.' });
    }

    if (method === 'crypto' && amountNum < 10) {
      return res.status(400).json({ error: 'Crypto withdrawals start from 10 units.' });
    }

    // Get wallet balance from MongoDB User model - use live balance
    let walletBalance = 0;
    try {
      const user = await User.findOne({ $or: [{ firebaseUid: userId }, { uid: userId }, { id: userId }] });
      if (!user) {
        return res.status(404).json({ error: 'User not found in database.' });
      }
      // Use wallet as primary source, fallback to balance
      walletBalance = Number(user.wallet || user.balance || 0);
      
      // Log balance check for debugging
      console.log(`Withdrawal balance check for ${userId}: wallet=${user.wallet}, balance=${user.balance}, using=${walletBalance}`);
    } catch (err) {
      console.error('Compute wallet balance failed:', err && err.message);
      return res.status(500).json({ error: 'Failed to compute wallet balance.' });
    }

    if (walletBalance < amountNum) {
      return res.status(400).json({ error: `Not enough balance. You have ₦${walletBalance}, but need ₦${amountNum}.` });
    }

    const charge = chargeFor(amountNum);
    const netAmount = Math.max(0, amountNum - charge);

    // Create withdrawal record in MongoDB
    const withdrawal = await Withdrawal.create({
      userId,
      firebaseUid: userId,
      name: req.user.name || req.user.email || 'User',
      amount: amountNum,
      method: method || 'bank',
      accountType: accountType || method || 'bank',
      accountId: accountId || null,
      accountName: accountName || null,
      accountNumber: accountNumber || null,
      bankName: bankName || null,
      cryptoType: cryptoType || null,
      walletAddress: walletAddress || null,
      walletType: walletType || null,
      status: 'Pending',
      charge,
      netAmount,
      risk: method === 'bank' ? 'Low' : 'Medium',
      date: cd,
      approvedAt: null,
      applied: false
    });

    // Immediately decrement user balance in MongoDB (reserve funds)
    try {
      const updatedUser = await User.findOneAndUpdate(
        { $or: [{ firebaseUid: userId }, { uid: userId }, { id: userId }] },
        { $inc: { wallet: -amountNum, balance: -amountNum } },
        { new: true }
      );
      
      if (!updatedUser) {
        // Rollback withdrawal if user not found
        await Withdrawal.findByIdAndDelete(withdrawal._id);
        return res.status(404).json({ error: 'User not found for balance update.' });
      }
    } catch (e) {
      console.error('Failed to reserve funds on withdrawal request:', e && e.message);
      // Rollback withdrawal if balance update failed
      try {
        await Withdrawal.findByIdAndDelete(withdrawal._id);
      } catch (rollbackErr) {
        console.error('Failed to rollback withdrawal:', rollbackErr.message);
      }
      return res.status(500).json({ error: 'Failed to reserve funds. Please try again.' });
    }

    // Create history log
    await createWithdrawalHistory({
      firebaseUid: userId,
      amount: amountNum,
      description: `Withdrawal requested: ₦${amountNum}`,
      status: 'pending',
      metadata: {
        referenceId: withdrawal._id.toString(),
        method: method,
        netAmount,
        charge
      }
    });

    return res.json({ 
      success: true, 
      withdrawal: {
        id: withdrawal._id.toString(),
        amount: amountNum,
        status: 'Pending',
        charge,
        netAmount,
        date: cd.toISOString()
      },
      charge, 
      netAmount 
    });
  } catch (error) {
    console.error('Create withdrawal error:', error);
    return res.status(500).json({ error: error.message || 'Failed to request withdrawal' });
  }
});

router.get('/my', verifyToken, async (req, res) => {
  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB is required. Database is unavailable.' });
    }

    const userId = req.user.uid || req.user.id;
    const rows = await Withdrawal.find({ userId }).sort({ createdAt: -1 }).limit(200).lean();
    return res.json(rows);
  } catch (error) {
    console.error('List my withdrawals error:', error);
    return res.status(500).json({ error: 'Failed to fetch your withdrawals' });
  }
});

router.get('/', async (req, res) => {
  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB is required. Database is unavailable.' });
    }

    const rows = await Withdrawal.find({}).sort({ createdAt: -1 }).limit(500).lean();
    return res.json(rows);
  } catch (error) {
    console.error('List withdrawals error:', error);
    return res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB is required. Database is unavailable.' });
    }

    const { status } = req.body || {};
    const target = await Withdrawal.findOne({ _id: req.params.id });
    if (!target) return res.status(404).json({ error: 'Withdrawal not found' });
    
    target.status = status || target.status;
    await target.save();
    return res.json({ success: true, id: req.params.id, status: target.status });
  } catch (error) {
    console.error('Update withdrawal status error:', error);
    return res.status(500).json({ error: 'Failed to update withdrawal status' });
  }
});

router.post('/:id/approve', async (req, res) => {
  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB is required. Database is unavailable.' });
    }

    const target = await Withdrawal.findOne({ _id: req.params.id });
    if (!target) return res.status(404).json({ error: 'Withdrawal not found' });
    if (target.status === 'Approved') return res.json({ success: true, id: req.params.id, status: 'Already Approved' });
    
    target.status = 'Approved';
    target.approvedAt = new Date().toISOString();
    await target.save();

    // Record withdrawal transaction in MongoDB
    try {
      const { getRate } = require('../config/exchange');
      let exchangeRate;
      try { exchangeRate = getRate(); } catch (e) { console.error('Exchange rate error:', e.message); return res.status(500).json({ error: 'Server misconfiguration: exchange rate' }); }
      const txCol = mongoNative.getTransactionsCollection();
      const amountNum = Number(target.amount || 0);
      const tx = {
        id: 'withdraw_' + Date.now(),
        userId: target.userId,
        type: 'withdraw',
        source: 'withdrawal',
        title: 'Withdrawal - approved',
        amountUsd: -(amountNum / exchangeRate),
        amountNaira: -Math.round(amountNum),
        date: new Date(),
        withdrawalId: target._id
      };
      await txCol.insertOne(tx);
    } catch (e) { 
      console.error('Failed to record withdraw tx in mongo:', e && e.message); 
    }

    await createWithdrawalHistory({
      firebaseUid: target.firebaseUid || target.userId,
      amount: Number(target.amount || 0),
      description: `Withdrawal approved: ₦${target.amount || 0}`,
      status: 'success',
      metadata: { referenceId: target._id, method: target.method, approvedAt: target.approvedAt }
    });

    return res.json({ success: true, id: req.params.id, status: 'Approved' });
  } catch (error) {
    console.error('Approve withdrawal error:', error);
    return res.status(500).json({ error: 'Failed to approve withdrawal' });
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB is required. Database is unavailable.' });
    }

    const target = await Withdrawal.findOne({ _id: req.params.id });
    if (!target) return res.status(404).json({ error: 'Withdrawal not found' });
    if (target.status === 'Rejected') return res.json({ success: true, id: req.params.id, status: 'Already Rejected' });
    
    target.status = 'Rejected';
    await target.save();

    await createWithdrawalHistory({
      firebaseUid: target.firebaseUid || target.userId,
      amount: Number(target.amount || 0),
      description: `Withdrawal rejected: ₦${target.amount || 0}`,
      status: 'failed',
      metadata: { referenceId: target._id, method: target.method, rejectedAt: new Date().toISOString() }
    });

    // Refund reserved funds to user wallet
    try {
      const amt = Number(target.amount || 0);
      if (amt > 0) {
        await User.findOneAndUpdate(
          { $or: [{ firebaseUid: target.userId }, { uid: target.userId }, { id: target.userId }] },
          { $inc: { wallet: amt, balance: amt } }
        );
      }
    } catch (e) { 
      console.warn('Refund on rejection (mongo) failed:', e && e.message); 
    }

    return res.json({ success: true, id: req.params.id, status: 'Rejected' });
  } catch (error) {
    console.error('Reject withdrawal error:', error);
    return res.status(500).json({ error: 'Failed to reject withdrawal' });
  }
});

module.exports = router;
