const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const verifyToken = require('../middleware/auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ACCOUNTS_PATH = path.join(DATA_DIR, 'accounts.json');

function ensureFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ACCOUNTS_PATH)) fs.writeFileSync(ACCOUNTS_PATH, '[]');
}

function readAccounts() {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8')); } catch (e) { return []; }
}

function writeAccounts(accounts) {
  ensureFiles();
  fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
}

// Add a bank account or crypto wallet for the logged-in user
router.post('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { type, bankName, accountNumber, accountName, cryptoType, walletAddress, network, label } = req.body;

    if (!type || !['bank','crypto'].includes(type)) {
      return res.status(400).json({ error: 'type must be bank or crypto' });
    }

    const accounts = readAccounts();
    const existing = accounts.filter(a => a.userId === userId && a.type === type);

    const entry = {
      id: Date.now().toString(),
      userId,
      type,
      bankName: bankName || null,
      accountNumber: accountNumber || null,
      accountName: accountName || null,
      cryptoType: cryptoType || null,
      walletAddress: walletAddress || null,
      network: network || null,
      label: label || (type === 'bank' ? (bankName || 'Bank account') : (cryptoType || 'Crypto wallet')),
      createdAt: new Date().toISOString()
    };

    if (type === 'bank') {
      if (!accountName || !accountNumber || !bankName) {
        return res.status(400).json({ error: 'Bank name, account number, and account name are required' });
      }
    } else if (type === 'crypto') {
      if (!walletAddress || !cryptoType) {
        return res.status(400).json({ error: 'Crypto type and wallet address are required' });
      }
    }

    accounts.unshift(entry);
    writeAccounts(accounts);
    res.json({ success: true, id: entry.id, account: entry, savedCount: existing.length + 1 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// List accounts
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const accounts = readAccounts().filter(a => a.userId === userId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(accounts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete account
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const accounts = readAccounts().filter(a => !(a.userId === userId && a.id === req.params.id));
    writeAccounts(accounts);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get single account by id (for withdrawal selection)
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const accounts = readAccounts();
    const account = accounts.find(a => a.userId === userId && a.id === req.params.id);
    if (!account) return res.status(404).json({ error: 'Not found' });
    res.json(account);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
