const express = require('express');
const router = express.Router();
const verifyToken = require('../middleware/auth');
const User = require('../models/User');
const mongoose = require('mongoose');

// Add a bank account or crypto wallet for the logged-in user
router.post('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { type, bankName, accountNumber, accountName, cryptoType, walletAddress, network, label } = req.body;

    if (!type || !['bank','crypto'].includes(type)) {
      return res.status(400).json({ error: 'type must be bank or crypto' });
    }

    if (type === 'bank') {
      if (!accountName || !accountNumber || !bankName) {
        return res.status(400).json({ error: 'Bank name, account number, and account name are required' });
      }
    } else if (type === 'crypto') {
      if (!walletAddress || !cryptoType) {
        return res.status(400).json({ error: 'Crypto type and wallet address are required' });
      }
    }

    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB is required. Database is unavailable.' });
    }

    // Save account to MongoDB User model
    const user = await User.findOneAndUpdate(
      { firebaseUid: userId },
      {
        $push: {
          accountDetails: {
            id: Date.now().toString(),
            type: type,
            bankName: bankName || null,
            accountNumber: accountNumber || null,
            accountName: accountName || null,
            cryptoType: cryptoType || null,
            walletAddress: walletAddress || null,
            network: network || null,
            label: label || (type === 'bank' ? (bankName || 'Bank account') : (cryptoType || 'Crypto wallet')),
            createdAt: new Date()
          }
        }
      },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const newAccount = user.accountDetails[user.accountDetails.length - 1];
    res.json({ success: true, id: newAccount.id, account: newAccount });
  } catch (e) {
    console.error('Add account error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// List accounts
router.get('/', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;

    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB is required. Database is unavailable.' });
    }

    const user = await User.findOne({ firebaseUid: userId }).lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const accounts = (user.accountDetails || [])
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    res.json(accounts);
  } catch (e) {
    console.error('List accounts error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Delete account
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const accountId = req.params.id;

    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB is required. Database is unavailable.' });
    }

    const user = await User.findOneAndUpdate(
      { firebaseUid: userId },
      { $pull: { accountDetails: { id: accountId } } },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ success: true, message: 'Account deleted' });
  } catch (e) {
    console.error('Delete account error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get single account by id (for withdrawal selection)
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.uid;
    const accountId = req.params.id;

    if (!mongoose.connection || mongoose.connection.readyState !== 1) {
      return res.status(503).json({ error: 'MongoDB is required. Database is unavailable.' });
    }

    const user = await User.findOne({ firebaseUid: userId }).lean();
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const account = (user.accountDetails || []).find(a => a.id === accountId);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    res.json(account);
  } catch (e) {
    console.error('Get account error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
