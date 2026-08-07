const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const verifyToken = require('../middleware/auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WITHDRAWALS_PATH = path.join(DATA_DIR, 'withdrawals.json');

function ensureFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(WITHDRAWALS_PATH)) fs.writeFileSync(WITHDRAWALS_PATH, '[]');
}

function readWithdrawals() {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(WITHDRAWALS_PATH, 'utf8')); } catch (e) { return []; }
}

function writeWithdrawals(items) {
  ensureFiles();
  fs.writeFileSync(WITHDRAWALS_PATH, JSON.stringify(items, null, 2));
}

// transactions helpers for creating withdrawal deduction txs
const TXN_PATH = path.join(DATA_DIR, 'transactions.json');
function readTransactions() { ensureFiles(); try { if (!fs.existsSync(TXN_PATH)) fs.writeFileSync(TXN_PATH, '[]'); return JSON.parse(fs.readFileSync(TXN_PATH,'utf8')||'[]'); } catch(e){ return []; } }
function saveTransactions(items) { ensureFiles(); fs.writeFileSync(TXN_PATH, JSON.stringify(items, null, 2)); }

// alerts helper (admin inbox)
const ALERTS_PATH = path.join(DATA_DIR, 'alerts.json');
function readAlerts() { ensureFiles(); try { if (!fs.existsSync(ALERTS_PATH)) fs.writeFileSync(ALERTS_PATH, '[]'); return JSON.parse(fs.readFileSync(ALERTS_PATH,'utf8')||'[]'); } catch(e){ return []; } }
function saveAlerts(items) { ensureFiles(); fs.writeFileSync(ALERTS_PATH, JSON.stringify(items, null, 2)); }

function chargeFor(amount) {
  const amountNum = Number(amount || 0);
  const charge = amountNum >= 20000 ? 0 : 500;
  return charge;
}

router.post('/request', verifyToken, (req, res) => {
  try {
    const { amount, method, accountId, walletType, accountType, accountName, accountNumber, bankName, cryptoType, walletAddress } = req.body;
    const userId = req.user.uid;
    const withdrawals = readWithdrawals();
    const cd = new Date();
    const today = cd.toISOString().slice(0, 10);
    const todaysCount = withdrawals.filter(w => w.userId === userId && w.date.startsWith(today)).length;

    if (todaysCount >= 3) {
      return res.status(403).json({ error: 'Withdrawal limit reached. You can do only 3 withdrawals per day.' });
    }

    const amountNum = Number(amount || 0);
    if (method === 'bank' && amountNum < 5500) {
      return res.status(400).json({ error: 'Bank withdrawals start from ₦5,500.' });
    }
    if (method === 'crypto' && amountNum < 10) {
      return res.status(400).json({ error: 'Crypto withdrawals start from 10 units.' });
    }

    const charge = chargeFor(amountNum);
    const netAmount = Math.max(0, amountNum - charge);
    const item = {
      id: Date.now().toString(),
      userId,
      name: req.user.name || req.user.email || 'User',
      amount: amountNum,
      method,
      accountType: accountType || method,
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

    withdrawals.unshift(item);
    writeWithdrawals(withdrawals);

    // Create an admin alert/inbox item for this withdrawal
    try {
      const alerts = readAlerts();
      const alert = {
        id: Date.now().toString() + '_' + Math.random().toString(36).slice(2,8),
        type: 'withdrawal',
        userId,
        name: item.name,
        email: req.user.email || '',
        message: `Withdrawal requested: ₦${amountNum}. Review required.`,
        meta: { amount: amountNum, method },
        createdAt: new Date().toISOString(),
        read: false
      };
      alerts.unshift(alert);
      saveAlerts(alerts);
    } catch (e) { console.warn('Failed to write withdrawal alert', e); }

    // Auto-approve if user's earning history is clean (no red alerts) and they have enough earned
    try {
      const allAlerts = readAlerts().filter(a => a.userId === userId && a.type && a.type === 'red_alert');
      const transactions = readTransactions().filter(t=>t.userId===userId && (Number(t.amountNaira||t.amountUsd*1500)||0) > 0);
      const totalEarned = transactions.reduce((s,t)=> s + (Number(t.amountNaira||Math.round((t.amountUsd||0)*1500))||0), 0);
      if (!allAlerts.length && totalEarned >= amountNum) {
        item.status = 'Approved';
        item.approvedAt = new Date().toISOString();
        // create deduction transaction (subtract amount from user's balance)
        const txs = readTransactions();
        const withdrawTx = {
          id: Date.now().toString(),
          userId,
          type: 'withdrawal',
          source: 'withdrawal_processed',
          title: 'User withdrawal processed',
          amountUsd: +( -amountNum / 1500 ).toFixed(6),
          amountNaira: -amountNum,
          date: new Date().toISOString(),
          metaWithdrawalId: item.id
        };
        txs.unshift(withdrawTx);
        saveTransactions(txs);
        item.applied = true;
        writeWithdrawals(withdrawals);
      }
    } catch (e) { console.warn('Auto-approve check failed', e); }

    res.json({ success: true, withdrawal: item, charge, netAmount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/my', verifyToken, (req, res) => {
  const userId = req.user.uid;
  const withdrawals = readWithdrawals().filter(w => w.userId === userId).sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(withdrawals);
});

router.get('/', (req, res) => {
  const withdrawals = readWithdrawals().sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(withdrawals);
});

router.put('/:id', (req, res) => {
  const { status } = req.body || {};
  const withdrawals = readWithdrawals();
  const target = withdrawals.find(w => w.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Withdrawal not found' });
  target.status = status || 'Approved';
  writeWithdrawals(withdrawals);
  res.json({ success: true, id: req.params.id, status: target.status });
});

router.post('/:id/approve', (req, res) => {
  const withdrawals = readWithdrawals();
  const target = withdrawals.find(w => w.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Withdrawal not found' });
  if (target.status === 'Approved') return res.json({ success: true, id: req.params.id, status: 'Already Approved' });
  target.status = 'Approved';
  target.approvedAt = new Date().toISOString();
  writeWithdrawals(withdrawals);

  // ensure we record deduction transaction once
  try {
    const txs = readTransactions();
    const already = txs.find(t => t.metaWithdrawalId === target.id);
    if (!already) {
      const withdrawTx = {
        id: Date.now().toString(),
        userId: target.userId,
        type: 'withdrawal',
        source: 'withdrawal_processed',
        title: 'Withdrawal processed',
        amountUsd: +( - (target.amount || 0) / 1500 ).toFixed(6),
        amountNaira: - (target.amount || 0),
        date: new Date().toISOString(),
        metaWithdrawalId: target.id
      };
      txs.unshift(withdrawTx);
      saveTransactions(txs);
    }
  } catch (e) { console.warn('Failed to write withdrawal transaction', e); }

  res.json({ success: true, id: req.params.id, status: 'Approved' });
});

router.post('/:id/reject', (req, res) => {
  const withdrawals = readWithdrawals();
  const target = withdrawals.find(w => w.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Withdrawal not found' });
  target.status = 'Rejected';
  writeWithdrawals(withdrawals);
  res.json({ success: true, id: req.params.id, status: 'Rejected' });
});

module.exports = router;
