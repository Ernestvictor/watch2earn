const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const Withdrawal = require('../models/withdrawal');
const verifyToken = require('../middleware/auth');
const User = require('../models/User');
const History = require('../models/history');
const mongoNative = require('../mongodb');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WITHDRAWALS_PATH = path.join(DATA_DIR, 'withdrawals.json');
const TXN_PATH = path.join(DATA_DIR, 'transactions.json');
const ALERTS_PATH = path.join(DATA_DIR, 'alerts.json');

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

function ensureFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(WITHDRAWALS_PATH)) fs.writeFileSync(WITHDRAWALS_PATH, '[]');
  if (!fs.existsSync(TXN_PATH)) fs.writeFileSync(TXN_PATH, '[]');
  if (!fs.existsSync(ALERTS_PATH)) fs.writeFileSync(ALERTS_PATH, '[]');
}

function readWithdrawals() {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(WITHDRAWALS_PATH, 'utf8') || '[]'); } catch (e) { return []; }
}

function writeWithdrawals(items) {
  ensureFiles();
  fs.writeFileSync(WITHDRAWALS_PATH, JSON.stringify(items, null, 2));
}

function readTransactions() {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(TXN_PATH, 'utf8') || '[]'); } catch (e) { return []; }
}

function saveTransactions(items) {
  ensureFiles();
  fs.writeFileSync(TXN_PATH, JSON.stringify(items, null, 2));
}

function readAlerts() {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(ALERTS_PATH, 'utf8') || '[]'); } catch (e) { return []; }
}

function saveAlerts(items) {
  ensureFiles();
  fs.writeFileSync(ALERTS_PATH, JSON.stringify(items, null, 2));
}

function chargeFor(amount) {
  const amountNum = Number(amount || 0);
  return amountNum >= 20000 ? 0 : 500;
}

router.post('/request', verifyToken, async (req, res) => {
  try {
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

    const withdrawals = readWithdrawals();
    const todaysCount = withdrawals.filter(w => w.userId === userId && String(w.date || '').startsWith(today)).length;
    if (todaysCount >= 3) {
      return res.status(403).json({ error: 'Withdrawal limit reached. You can do only 3 withdrawals per day.' });
    }

    if (method === 'bank' && amountNum < 5500) {
      return res.status(400).json({ error: 'Bank withdrawals start from ₦5,500.' });
    }

    if (method === 'crypto' && amountNum < 10) {
      return res.status(400).json({ error: 'Crypto withdrawals start from 10 units.' });
    }

    let walletBalance = 0;
    try {
      // Prefer native Mongo transactions + withdrawals aggregates when available
      if (typeof mongoNative.getTransactionsCollection === 'function') {
        const txCol = mongoNative.getTransactionsCollection();
        const txs = await txCol.find({ userId }).toArray();
        const totalEarnNaira = txs.reduce((s, t) => s + (Number(t.amountNaira || Math.round((t.amountUsd || 0) * 1500)) ), 0);

        // sum withdrawals (use mongoose Withdrawal collection when available, else file)
        let withdrawalsSum = 0;
        if (mongoose.connection && mongoose.connection.readyState === 1) {
          const wdocs = await Withdrawal.find({ userId }).lean();
          withdrawalsSum = wdocs.reduce((s, w) => s + Number(w.amount || 0), 0);
        } else {
          const allWithdrawals = readWithdrawals();
          withdrawalsSum = allWithdrawals.filter(w => w.userId === userId).reduce((s, w) => s + Number(w.amount || 0), 0);
        }

        walletBalance = Math.max(0, Math.round(totalEarnNaira - withdrawalsSum));
      } else if (mongoose.connection && mongoose.connection.readyState === 1) {
        const user = await User.findOne({ firebaseUid: userId }).lean();
        walletBalance = Number(user?.wallet || user?.balance || 0);
      } else {
        const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8') || '[]');
        const user = users.find(u => (u.firebaseUid || u.uid || '').toString() === userId.toString());
        walletBalance = Number(user?.wallet || user?.balance || 0);
      }
    } catch (err) {
      console.error('Compute wallet balance failed:', err && err.message);
      // fallback to stored wallet field
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        const user = await User.findOne({ firebaseUid: userId }).lean();
        walletBalance = Number(user?.wallet || user?.balance || 0);
      } else {
        const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8') || '[]');
        const user = users.find(u => (u.firebaseUid || u.uid || '').toString() === userId.toString());
        walletBalance = Number(user?.wallet || user?.balance || 0);
      }
    }

    if (walletBalance < amountNum) {
      return res.status(400).json({ error: `Not enough balance. You have ₦${walletBalance}, but need ₦${amountNum}.` });
    }

    const charge = chargeFor(amountNum);
    const netAmount = Math.max(0, amountNum - charge);
    const item = {
      id: Date.now().toString(),
      userId,
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
      date: cd.toISOString()
    };

    if (mongoose.connection && mongoose.connection.readyState === 1) {
      await Withdrawal.create({
        userId,
        firebaseUid: userId,
        name: item.name,
        amount: amountNum,
        method: item.method,
        accountType: item.accountType,
        accountId: item.accountId,
        accountName: item.accountName,
        accountNumber: item.accountNumber,
        bankName: item.bankName,
        cryptoType: item.cryptoType,
        walletAddress: item.walletAddress,
        walletType: item.walletType,
        status: item.status,
        charge,
        netAmount,
        risk: item.risk,
        date: item.date,
        approvedAt: null,
        applied: false
      });
    } else {
      const allWithdrawals = readWithdrawals();
      allWithdrawals.unshift(item);
      writeWithdrawals(allWithdrawals);
    }

    await createWithdrawalHistory({
      firebaseUid: userId,
      amount: amountNum,
      description: `Withdrawal requested: ₦${amountNum}`,
      status: 'pending',
      metadata: {
        referenceId: item.id,
        method: item.method,
        netAmount,
        charge
      }
    });

    try {
      const alerts = readAlerts();
      alerts.unshift({
        id: Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8),
        type: 'withdrawal',
        userId,
        name: item.name,
        email: req.user.email || '',
        message: `Withdrawal requested: ₦${amountNum}. Review required.`,
        meta: { amount: amountNum, method: item.method },
        createdAt: new Date().toISOString(),
        read: false
      });
      saveAlerts(alerts);
    } catch (e) {
      console.warn('Failed to write withdrawal alert', e);
    }

    return res.json({ success: true, withdrawal: item, charge, netAmount });
  } catch (error) {
    console.error('Create withdrawal error:', error);
    return res.status(500).json({ error: error.message || 'Failed to request withdrawal' });
  }
});

router.get('/my', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid || req.user.id;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const rows = await Withdrawal.find({ userId }).sort({ createdAt: -1 }).limit(200).lean();
      return res.json(rows);
    }
    const rows = readWithdrawals().filter(w => w.userId === userId).sort((a, b) => new Date(b.date) - new Date(a.date));
    return res.json(rows);
  } catch (error) {
    console.error('List my withdrawals error:', error);
    return res.status(500).json({ error: 'Failed to fetch your withdrawals' });
  }
});

router.get('/', async (req, res) => {
  try {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const rows = await Withdrawal.find({}).sort({ createdAt: -1 }).limit(500).lean();
      return res.json(rows);
    }
    const rows = readWithdrawals().sort((a, b) => new Date(b.date) - new Date(a.date));
    return res.json(rows);
  } catch (error) {
    console.error('List withdrawals error:', error);
    return res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { status } = req.body || {};

    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const target = await Withdrawal.findOne({ _id: req.params.id });
      if (!target) return res.status(404).json({ error: 'Withdrawal not found' });
      target.status = status || target.status;
      await target.save();
      return res.json({ success: true, id: req.params.id, status: target.status });
    }

    const withdrawals = readWithdrawals();
    const target = withdrawals.find(w => w.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Withdrawal not found' });
    target.status = status || target.status;
    writeWithdrawals(withdrawals);
    return res.json({ success: true, id: req.params.id, status: target.status });
  } catch (error) {
    console.error('Update withdrawal status error:', error);
    return res.status(500).json({ error: 'Failed to update withdrawal status' });
  }
});

router.post('/:id/approve', async (req, res) => {
  try {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const target = await Withdrawal.findOne({ _id: req.params.id });
      if (!target) return res.status(404).json({ error: 'Withdrawal not found' });
      if (target.status === 'Approved') return res.json({ success: true, id: req.params.id, status: 'Already Approved' });
      target.status = 'Approved';
      target.approvedAt = new Date().toISOString();
      await target.save();
      // Insert a withdraw transaction and decrement user's balance
      try {
        const txCol = mongoNative.getTransactionsCollection();
        const usersCol = mongoNative.getUsersCollection();
        const amountNum = Number(target.amount || 0);
        const tx = {
          id: 'withdraw_' + Date.now(),
          userId: target.userId,
          type: 'withdraw',
          source: 'withdrawal',
          title: 'Withdrawal - approved',
          amountUsd: -(amountNum / 1500),
          amountNaira: -Math.round(amountNum),
          date: new Date(),
          withdrawalId: target._id
        };
        await txCol.insertOne(tx);
        // decrement user balance in users collection if exists
        try { await usersCol.updateOne({ $or: [{ uid: target.userId }, { firebaseUid: target.userId }, { id: target.userId }] }, { $inc: { balance: -amountNum, totalWithdrawn: amountNum } }); } catch (e) {}
      } catch (e) { console.error('Failed to record withdraw tx in mongo:', e && e.message); }
      await createWithdrawalHistory({
        firebaseUid: target.firebaseUid || target.userId,
        amount: Number(target.amount || 0),
        description: `Withdrawal approved: ₦${target.amount || 0}`,
        status: 'success',
        metadata: { referenceId: target.id || target._id, method: target.method, approvedAt: target.approvedAt }
      });
      return res.json({ success: true, id: req.params.id, status: 'Approved' });
    }

    const withdrawals = readWithdrawals();
    const target = withdrawals.find(w => w.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Withdrawal not found' });
    if (target.status === 'Approved') return res.json({ success: true, id: req.params.id, status: 'Already Approved' });

    target.status = 'Approved';
    target.approvedAt = new Date().toISOString();
    writeWithdrawals(withdrawals);

    // record transaction in transactions.json and decrement file-based user balance
    try {
      const txs = readTransactions();
      const amountNum = Number(target.amount || 0);
      txs.unshift({ id: 'withdraw_' + Date.now(), userId: target.userId, type: 'withdraw', source: 'withdrawal', title: 'Withdrawal - approved', amountUsd: -(amountNum/1500), amountNaira: -Math.round(amountNum), date: new Date().toISOString(), withdrawalId: target.id });
      saveTransactions(txs);
    } catch (e) { console.error('Failed to write withdraw tx to file:', e && e.message); }

    try {
      const users = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8') || '[]');
      const u = users.find(x => (x.uid === target.userId) || (x.id === target.userId) || ((x.email||'').toLowerCase() === (target.email||'').toLowerCase()));
      if (u) { u.balance = Math.max(0, (Number(u.balance || 0) - Number(target.amount || 0))); fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(users, null, 2)); }
    } catch (e) { console.error('Failed to decrement file user balance:', e && e.message); }

    await createWithdrawalHistory({
      firebaseUid: target.userId,
      amount: Number(target.amount || 0),
      description: `Withdrawal approved: ₦${target.amount || 0}`,
      status: 'success',
      metadata: { referenceId: target.id, method: target.method, approvedAt: target.approvedAt }
    });

    return res.json({ success: true, id: req.params.id, status: 'Approved' });
  } catch (error) {
    console.error('Approve withdrawal error:', error);
    return res.status(500).json({ error: 'Failed to approve withdrawal' });
  }
});

router.post('/:id/reject', async (req, res) => {
  try {
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const target = await Withdrawal.findOne({ _id: req.params.id });
      if (!target) return res.status(404).json({ error: 'Withdrawal not found' });
      target.status = 'Rejected';
      await target.save();
      await createWithdrawalHistory({
        firebaseUid: target.firebaseUid || target.userId,
        amount: Number(target.amount || 0),
        description: `Withdrawal rejected: ₦${target.amount || 0}`,
        status: 'failed',
        metadata: { referenceId: target.id || target._id, method: target.method, rejectedAt: new Date().toISOString() }
      });
      return res.json({ success: true, id: req.params.id, status: 'Rejected' });
    }

    const withdrawals = readWithdrawals();
    const target = withdrawals.find(w => w.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Withdrawal not found' });
    target.status = 'Rejected';
    writeWithdrawals(withdrawals);

    await createWithdrawalHistory({
      firebaseUid: target.userId,
      amount: Number(target.amount || 0),
      description: `Withdrawal rejected: ₦${target.amount || 0}`,
      status: 'failed',
      metadata: { referenceId: target.id, method: target.method, rejectedAt: new Date().toISOString() }
    });

    return res.json({ success: true, id: req.params.id, status: 'Rejected' });
  } catch (error) {
    console.error('Reject withdrawal error:', error);
    return res.status(500).json({ error: 'Failed to reject withdrawal' });
  }
});

module.exports = router;
