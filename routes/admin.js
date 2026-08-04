const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');
const axios = require('axios');

// Admin login
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ id: 'admin-001', isAdmin: true }, process.env.JWT_SECRET, { expiresIn: '1d' });
    return res.json({ token });
  }
  res.status(401).json({ error: 'Unauthorized' });
});

// Get all withdrawals
router.get('/withdrawals', (req, res) => {
  db.all(`SELECT * FROM withdrawals`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// User requests withdrawal (only if balance ≥ ₦5500)
router.post('/withdrawals/request', (req, res) => {
  const { userId, amount, recipientCode } = req.body;

  db.get(`SELECT balanceUsd FROM users WHERE id=?`, [userId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'User not found' });

    // Convert USD balance to Naira (example rate: 1500)
    const balanceNaira = row.balanceUsd * 1500;
    if (balanceNaira < 5500) {
      return res.status(403).json({ error: 'Minimum withdrawal is ₦5500' });
    }

    // Insert withdrawal request
    db.run(
      `INSERT INTO withdrawals (userId, amount, recipientCode, status, date) VALUES (?, ?, ?, 'Pending', ?)`,
      [userId, amount, recipientCode, new Date().toISOString()],
      function (err2) {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ id: this.lastID, status: 'Pending' });
      }
    );
  });
});

// Approve withdrawal → trigger Paystack transfer
router.post('/withdrawals/:id/approve', (req, res) => {
  const withdrawalId = req.params.id;

  db.get(`SELECT * FROM withdrawals WHERE id=?`, [withdrawalId], async (err, withdrawal) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!withdrawal) return res.status(404).json({ error: 'Withdrawal not found' });

    try {
      // Call Paystack transfer API
      const response = await axios.post(
        'https://api.paystack.co/transfer',
        {
          source: 'balance',
          amount: withdrawal.amount * 100, // Paystack uses kobo
          recipient: withdrawal.recipientCode,
          reason: 'Watch2Earn payout'
        },
        { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
      );

      // Update withdrawal status
      db.run(`UPDATE withdrawals SET status='Approved' WHERE id=?`, [withdrawalId], (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ id: withdrawalId, status: 'Approved', paystack: response.data });
      });
    } catch (e) {
      res.status(500).json({ error: 'Paystack transfer failed', details: e.message });
    }
  });
});

// Reject withdrawal
router.post('/withdrawals/:id/reject', (req, res) => {
  db.run(`UPDATE withdrawals SET status='Rejected' WHERE id=?`, [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: req.params.id, status: 'Rejected' });
  });
});

module.exports = router;
