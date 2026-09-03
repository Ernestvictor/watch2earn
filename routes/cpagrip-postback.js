const express = require('express');
const router = express.Router();
const mongoNative = require('../mongodb');

// CPAgrip postback handler — MongoDB-only implementation
router.get('/postback/cpagrip', async (req, res) => {
  const { subid, payout, status, secret } = req.query;

  if (!mongoNative || typeof mongoNative.getUsersCollection !== 'function') {
    return res.status(503).send('MongoDB required');
  }

  // Validate secret
  const expected = process.env.CPAGRIP_SECRET || process.env.CPAGRIP_KEY;
  if (!expected || String(secret) !== String(expected)) {
    console.warn('Invalid CPAGRIP secret on postback');
    return res.status(403).send('Invalid secret');
  }

  if (String(status) !== '1' || !subid || !payout) {
    return res.send('OK');
  }

  try {
    const usersCol = mongoNative.getUsersCollection();
    const txCol = mongoNative.getTransactionsCollection();

    const cleanEmail = String(subid).toLowerCase().trim();
    const amount = parseFloat(payout) || 0;
    if (!amount || amount <= 0) return res.send('OK');

    // Credit user (upsert)
    await usersCol.updateOne(
      { email: cleanEmail },
      { $inc: { balance: amount, totalEarned: amount, fromCPA: amount }, $setOnInsert: { email: cleanEmail, createdAt: new Date(), uid: 'u_' + Date.now() } },
      { upsert: true }
    );

    await txCol.insertOne({ email: cleanEmail, type: 'earn', source: 'CPAgrip', amount: amount, createdAt: new Date() });

    console.log(`✅ Credited $${amount} to ${cleanEmail} (CPAGrip)`);
    return res.send('OK');
  } catch (e) {
    console.error('CPAGrip postback error:', e && e.message);
    return res.status(500).send('Error');
  }
});

module.exports = router;