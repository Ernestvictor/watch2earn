const express = require('express');
const router = express.Router();
const { db } = require('../config/firebaseAdmin');
const verifyToken = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

// GET user profile — compute live balances from data/transactions.json when available
router.get('/profile', verifyToken, async (req, res) => {
  const userId = req.user.uid || req.user.id;
  const DATA_DIR = path.join(__dirname, '..', 'data');
  const TXN_PATH = path.join(DATA_DIR, 'transactions.json');

  try {
    // try to compute from local transactions file first
    let txs = [];
    try {
      if (fs.existsSync(TXN_PATH)) txs = JSON.parse(fs.readFileSync(TXN_PATH, 'utf8') || '[]');
    } catch (e) { txs = []; }

    const myTx = txs.filter(t => t.userId === userId);
    const totalUsd = myTx.reduce((s, t) => s + Number(t.amountUsd || 0), 0);
    const adsUsd = myTx.filter(t => (t.type||'').toLowerCase().includes('ad')).reduce((s,t)=>s+Number(t.amountUsd||0),0);
    const gameUsd = myTx.filter(t => (t.type||'').toLowerCase().includes('game')).reduce((s,t)=>s+Number(t.amountUsd||0),0);
    const surveyUsd = myTx.filter(t => (t.type||'').toLowerCase().includes('survey')).reduce((s,t)=>s+Number(t.amountUsd||0),0);
    const refUsd = myTx.filter(t => (t.type||'').toLowerCase().includes('referral') || (t.type||'').toLowerCase().includes('commission')).reduce((s,t)=>s+Number(t.amountUsd||0),0);

    // invited count and announcement — try firestore but it's optional
    let displayName = req.user.name || 'User';
    let email = req.user.email || '';
    let invitedCount = 0;
    let announcement = '';
    try {
      const userDoc = await db.collection('users').doc(userId).get();
      const u = userDoc.exists ? userDoc.data() : null;
      displayName = u?.displayName || displayName;
      email = u?.email || email;
      invitedCount = u?.invitedCount || 0;
      announcement = u?.announcement || '';
    } catch (e) {
      // ignore firestore errors — we'll still return computed values
    }

    return res.json({
      balanceUsd: +totalUsd.toFixed(6),
      adsEarn: +adsUsd.toFixed(6),
      gameEarn: +gameUsd.toFixed(6),
      surveyEarn: +surveyUsd.toFixed(6),
      refEarn: +refUsd.toFixed(6),
      invitedCount: invitedCount || 0,
      announcement,
      displayName,
      email
    });

  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

module.exports = router;
