const express = require('express');
const router = express.Router();
const localDb = require('../db');
const { db: firestoreDb, auth } = require('../config/firebaseAdmin');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MESSAGES_PATH = path.join(DATA_DIR, 'messages.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const WITHDRAWALS_PATH = path.join(DATA_DIR, 'withdrawals.json');
const TRANSACTIONS_PATH = path.join(DATA_DIR, 'transactions.json');

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MESSAGES_PATH)) fs.writeFileSync(MESSAGES_PATH, '[]');
  if (!fs.existsSync(SETTINGS_PATH)) fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ dailyAdLimit: 5, bonusAdCount: 0, lastAnnouncement: '' }, null, 2));
  if (!fs.existsSync(WITHDRAWALS_PATH)) fs.writeFileSync(WITHDRAWALS_PATH, '[]');
  if (!fs.existsSync(TRANSACTIONS_PATH)) fs.writeFileSync(TRANSACTIONS_PATH, '[]');
}

function readMessages() {
  ensureDataFiles();
  try {
    return JSON.parse(fs.readFileSync(MESSAGES_PATH, 'utf8'));
  } catch (error) {
    return [];
  }
}

function writeMessages(messages) {
  ensureDataFiles();
  fs.writeFileSync(MESSAGES_PATH, JSON.stringify(messages, null, 2));
}

function readSettings() {
  ensureDataFiles();
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch (error) {
    return { dailyAdLimit: 5, bonusAdCount: 0, lastAnnouncement: '' };
  }
}

function writeSettings(settings) {
  ensureDataFiles();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function readWithdrawals() {
  ensureDataFiles();
  try {
    return JSON.parse(fs.readFileSync(WITHDRAWALS_PATH, 'utf8'));
  } catch (error) {
    return [];
  }
}

function writeWithdrawals(rows) {
  ensureDataFiles();
  fs.writeFileSync(WITHDRAWALS_PATH, JSON.stringify(rows, null, 2));
}

function readUsers() {
  ensureDataFiles();
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'users.json'), 'utf8')) || [];
  } catch (error) {
    return [];
  }
}

function writeUsers(users) {
  ensureDataFiles();
  fs.writeFileSync(path.join(DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));
}

function readAccounts() {
  ensureDataFiles();
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'accounts.json'), 'utf8')) || [];
  } catch (error) {
    return [];
  }
}

function readTransactions() {
  ensureDataFiles();
  try {
    return JSON.parse(fs.readFileSync(TRANSACTIONS_PATH, 'utf8')) || [];
  } catch (error) {
    return [];
  }
}

function writeTransactions(transactions) {
  ensureDataFiles();
  fs.writeFileSync(TRANSACTIONS_PATH, JSON.stringify(transactions, null, 2));
}

function transactionsByDay(transactions, days = 7) {
  const today = new Date();
  const labels = [];
  const data = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const label = date.toLocaleDateString('en-US', { weekday: 'short' });
    labels.push(label);
    const total = transactions
      .filter(tx => new Date(tx.date).toDateString() === date.toDateString())
      .reduce((sum, tx) => sum + Number(tx.amount || 0), 0);
    data.push(Number(total.toFixed(2)));
  }
  return { labels, data };
}

function countTransactionsByDay(transactions, days = 7) {
  const today = new Date();
  const labels = [];
  const data = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
    const count = transactions.filter(tx => new Date(tx.date).toDateString() === date.toDateString()).length;
    data.push(count);
  }
  return { labels, data };
}

async function listAllFirebaseUsers() {
  const allUsers = [];
  let nextPageToken;
  do {
    const result = await auth.listUsers(1000, nextPageToken);
    allUsers.push(...result.users.map(u => ({
      uid: u.uid,
      email: u.email || 'Unknown',
      displayName: u.displayName || '',
      disabled: u.disabled,
      metadata: u.metadata || {}
    })));
    nextPageToken = result.pageToken;
  } while (nextPageToken);
  return allUsers;
}

// Admin login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@watch2earn.com';
  const adminPass = process.env.ADMIN_PASSWORD || 'admin1234';
  const jwtSecret = process.env.JWT_SECRET || 'dev-secret';

  if (email === adminEmail && password === adminPass) {
    const token = jwt.sign({ id: 'admin-001', isAdmin: true }, jwtSecret, { expiresIn: '1d' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Unauthorized' });
});

router.get('/dashboard', async (req, res) => {
  try {
    const withdrawals = readWithdrawals();
    const transactions = readTransactions();
    const users = await listAllFirebaseUsers();
    
    const totalPayout = withdrawals.reduce((sum, w) => sum + Number(w.netAmount || w.amount || 0), 0);
    const pendingCount = withdrawals.filter(w => w.status === 'Pending').length;
    const totalUserEarnings = transactions.reduce((sum, t) => sum + Number(t.amount || 0), 0);
    
    res.json({
      totalBalance: totalPayout,
      profit: Math.floor(totalPayout * 0.3),
      userProfit: totalUserEarnings,
      users: users.length || 0,
      withdrawals: pendingCount,
      revenue: Math.floor(totalPayout * 0.3),
      activity: [
        `${withdrawals.length} withdrawal requests processed`,
        `${transactions.length} earnings transactions recorded`,
        `${users.length} users registered`,
        'Admin panel active and syncing live data'
      ]
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: 'Failed to load dashboard data' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const users = await listAllFirebaseUsers();
    const activeUsers = users.slice(0, 10);
    const passiveUsers = users.slice(10, 20);
    
    const realUsers = users.length;
    const botUsers = 0;
    
    res.json({
      healthScore: users.length > 0 ? 85 : 100,
      real: realUsers,
      bots: botUsers,
      total: users.length,
      today: 0,
      week: 0,
      month: users.length,
      users: users.map(u => ({
        id: u.uid,
        name: u.displayName || u.email?.split('@')[0] || 'Unknown User',
        email: u.email || 'user@watch2earn.com',
        role: 'User',
        status: u.disabled ? 'Disabled' : 'Active'
      })),
      active: activeUsers,
      passive: passiveUsers
    });
  } catch (error) {
    console.error('Users error:', error);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

router.get('/users/active', async (req, res) => {
  try {
    const users = await listAllFirebaseUsers();
    res.json(users.slice(0, 10).map(u => ({
      email: u.email,
      lastActive: u.metadata.lastLoginTime || 'Unknown'
    })));
  } catch (error) {
    console.error('Active users error:', error);
    res.status(500).json([]);
  }
});

router.get('/users/passive', async (req, res) => {
  try {
    const users = await listAllFirebaseUsers();
    res.json(users.slice(10, 20).map(u => ({
      email: u.email,
      lastActive: u.metadata.lastLoginTime || 'Unknown'
    })));
  } catch (error) {
    console.error('Passive users error:', error);
    res.status(500).json([]);
  }
});

router.put('/users/:id', (req, res) => {
  const { action } = req.body;
  res.json({ success: true, id: req.params.id, action: action || 'updated' });
});

router.get('/withdrawals', (req, res) => {
  const withdrawals = readWithdrawals().sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json({
    totalPayout: withdrawals.reduce((sum, item) => sum + Number(item.netAmount || item.amount || 0), 0),
    pendingPayout: withdrawals.filter(item => item.status === 'Pending').length,
    withdrawals: withdrawals.map((item) => ({
      id: item.id,
      name: item.name || 'User',
      amount: item.netAmount || item.amount || 0,
      method: item.method || 'bank',
      status: item.status || 'Pending',
      risk: item.risk || 'Low'
    }))
  });
});

router.put('/withdrawals/:id', (req, res) => {
  const { status } = req.body;
  const update = status || 'Approved';
  const withdrawals = readWithdrawals();
  const target = withdrawals.find(item => item.id === req.params.id);
  if (target) target.status = update;
  writeWithdrawals(withdrawals);
  res.json({ success: true, id: req.params.id, status: update });
});

// Existing legacy endpoints
router.get('/withdrawals/request', (req, res) => {
  res.json({ success: true, message: 'Withdrawal requests are handled by the frontend flow.' });
});

router.post('/withdrawals/:id/approve', (req, res) => {
  const withdrawalId = req.params.id;
  res.json({ id: withdrawalId, status: 'Approved' });
});

router.post('/withdrawals/:id/reject', (req, res) => {
  const withdrawalId = req.params.id;
  res.json({ id: withdrawalId, status: 'Rejected' });
});

router.get('/history', (req, res) => {
  const transactions = readTransactions();
  const withdrawals = readWithdrawals();
  
  const totalPaid = withdrawals.filter(w => w.status === 'Approved').reduce((sum, w) => sum + Number(w.netAmount || w.amount || 0), 0);
  const thisMonth = new Date().getMonth();
  const paidMonth = withdrawals
    .filter(w => w.status === 'Approved' && new Date(w.date).getMonth() === thisMonth)
    .reduce((sum, w) => sum + Number(w.netAmount || w.amount || 0), 0);
  
  const earningsList = transactions.map(tx => ({
    id: tx.id,
    date: tx.date ? new Date(tx.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
    txnId: tx.id,
    user: tx.userId || 'User',
    amount: Number(tx.amount || 0).toFixed(2),
    method: tx.source || 'ad',
    status: 'Earned',
    fee: 0,
    net: Number(tx.amount || 0).toFixed(2),
    proof: 'Earning'
  }));
  
  res.json({
    totalPaid: totalPaid,
    paidMonth: paidMonth,
    transactions: earningsList,
    updates: [
      { date: new Date().toISOString().split('T')[0], type: 'Dashboard', description: 'Admin panel showing live earnings and withdrawals data.' },
      { date: new Date().toISOString().split('T')[0], type: 'System', description: 'Data synced from JSON storage in real-time.' }
    ]
  });
});

router.get('/history/export', (req, res) => {
  const format = req.query.format || 'csv';
  res.json({ success: true, message: `Export endpoint called for ${format}.` });
});

router.get('/history/proof/:id', (req, res) => {
  res.json({ success: true, message: `Proof requested for transaction ${req.params.id}.` });
});

router.get('/messages', (req, res) => {
  const messages = readMessages();
  res.json(messages);
});

router.post('/messages', (req, res) => {
  const payload = req.body || {};
  const messages = readMessages();
  const newMessage = {
    id: Date.now().toString(),
    title: payload.template || 'Watch2Earn Update',
    message: payload.message || 'New update from admin panel.',
    audience: payload.audience || 'all',
    severity: payload.severity || 'normal',
    channel: payload.channel || 'inapp',
    schedule: payload.schedule || 'now',
    createdAt: new Date().toISOString()
  };

  if (Number.isFinite(Number(payload.bonusAds)) && Number(payload.bonusAds) >= 0) {
    const settings = readSettings();
    settings.bonusAdCount = Number(payload.bonusAds);
    settings.dailyAdLimit = Math.max(5, Number(settings.dailyAdLimit || 5) + Number(payload.bonusAds));
    settings.lastAnnouncement = newMessage.message;
    writeSettings(settings);
  }

  messages.unshift(newMessage);
  writeMessages(messages);
  res.json({ success: true, message: newMessage });
});

router.get('/settings', (req, res) => {
  res.json(readSettings());
});

router.post('/settings', (req, res) => {
  const settings = readSettings();
  const payload = req.body || {};
  if (payload.dailyAdLimit) settings.dailyAdLimit = Number(payload.dailyAdLimit);
  if (payload.bonusAdCount || payload.bonusAdCount === 0) settings.bonusAdCount = Number(payload.bonusAdCount);
  if (payload.lastAnnouncement) settings.lastAnnouncement = payload.lastAnnouncement;
  writeSettings(settings);
  res.json(settings);
});

router.get('/chart/earnings', (req, res) => {
  const transactions = readTransactions();
  const result = transactionsByDay(transactions, 7);
  res.json(result);
});

router.get('/chart/ads-watched', (req, res) => {
  const transactions = readTransactions();
  const result = countTransactionsByDay(transactions, 7);
  res.json(result);
});

// Serve ads manager UI
router.get('/ads-manager', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin-panel', 'ads.html'));
});

router.get('/chart/earnings-summary', (req, res) => {
  const transactions = readTransactions();
  const now = new Date();
  const summary = {
    '1-day': '$0',
    '7-days': '$0',
    '30-days': '$0',
    '90-days': '$0'
  };
  const totals = { '1-day': 0, '7-days': 0, '30-days': 0, '90-days': 0 };
  transactions.forEach(tx => {
    const date = new Date(tx.date);
    const diff = Math.ceil((now - date) / (1000 * 60 * 60 * 24));
    const amount = Number(tx.amount || 0);
    if (diff <= 1) totals['1-day'] += amount;
    if (diff <= 7) totals['7-days'] += amount;
    if (diff <= 30) totals['30-days'] += amount;
    if (diff <= 90) totals['90-days'] += amount;
  });
  Object.keys(totals).forEach(key => {
    summary[key] = `$${totals[key].toFixed(2)}`;
  });
  res.json(summary);
});

router.get('/users/active', async (req, res) => {
  try {
    const users = await listAllFirebaseUsers();
    res.json(users.slice(0, 10).map(u => ({
      email: u.email,
      lastActive: u.metadata.lastSignInTime || 'Unknown'
    })));
  } catch (error) {
    console.error('Active users error:', error);
    res.status(500).json([]);
  }
});

router.get('/users/passive', async (req, res) => {
  try {
    const users = await listAllFirebaseUsers();
    res.json(users.slice(10, 20).map(u => ({
      email: u.email,
      lastActive: u.metadata.lastSignInTime || 'Unknown'
    })));
  } catch (error) {
    console.error('Passive users error:', error);
    res.status(500).json([]);
  }
});

// Legacy admin withdraw approval path used by older docs
router.get('/withdrawals/:id', (req, res) => {
  const target = sampleWithdrawals.find(item => item.id === req.params.id);
  if (!target) return res.status(404).json({ error: 'Withdrawal not found' });
  res.json(target);
});

module.exports = router;
