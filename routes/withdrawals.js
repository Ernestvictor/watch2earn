const express = require('express');
const router = express.Router();
const { db } = require('../config/firebaseAdmin');

router.post('/', async (req, res) => {
  try {
    const { amount, method, accountDetails } = req.body;
    if (amount < 5500) return res.status(400).json({ error: 'Minimum ₦5,500' });

    const withdrawalRef = db.collection('withdrawals').doc();
    await withdrawalRef.set({
      userId: req.user.uid,
      amount,
      method,
      accountDetails,
      status: 'Pending',
      createdAt: new Date().toISOString()
    });

    res.json({ id: withdrawalRef.id, status: 'Pending' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process withdrawal' });
  }
});

module.exports = router;
