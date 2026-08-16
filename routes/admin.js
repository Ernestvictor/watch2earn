const express = require('express');
const router = express.Router();
const User = require('../models/User');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TRANSACTIONS_PATH = path.join(DATA_DIR, 'transactions.json');
const MESSAGES_PATH = path.join(DATA_DIR, 'messages.json');

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TRANSACTIONS_PATH)) fs.writeFileSync(TRANSACTIONS_PATH, '[]');
  if (!fs.existsSync(MESSAGES_PATH)) fs.writeFileSync(MESSAGES_PATH, '[]');
}

function readJson(file) {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  ensureDataFiles();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

router.post('/watch-ad', async (req, res) => {
  try {
    const { firebaseUid, amount = 10 } = req.body;

    // 1. Get user
    const user = await User.findOne({ firebaseUid });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.isBanned) return res.status(403).json({ error: 'User is banned' });

    // 2. Update wallet
    user.wallet += amount;
    await user.save();

    // 3. Record transaction in JSON
    const transactions = readJson(TRANSACTIONS_PATH);
    transactions.push({
      id: Date.now().toString(),
      userId: user._id.toString(),
      firebaseUid,
      amount,
      type: 'ad',
      date: new Date().toISOString()
    });
    writeJson(TRANSACTIONS_PATH, transactions);

    // 4. Record message in JSON
    const messages = readJson(MESSAGES_PATH);
    messages.push({
      id: Date.now().toString(),
      userId: user._id.toString(),
      firebaseUid,
      message: `You earned ₦${amount} for watching an ad`,
      type: 'earning',
      createdAt: new Date().toISOString()
    });
    writeJson(MESSAGES_PATH, messages);

    res.json({ success: true, newWallet: user.wallet });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
