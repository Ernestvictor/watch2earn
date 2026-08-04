const express = require('express');
const router = express.Router();
const { db, admin } = require('../config/firebaseAdmin');
const { verifyUser } = require('../middleware/auth');

// Add a bank account or crypto wallet for the logged-in user
router.post('/', verifyUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { type, bankName, accountNumber, accountName, cryptoType, walletAddress, network, label } = req.body;
    if (!type || !['bank','crypto'].includes(type)) return res.status(400).json({ error: 'type must be bank or crypto' });

    const doc = await db.collection('users').doc(userId).collection('accounts').add({
      type,
      bankName: bankName || null,
      accountNumber: accountNumber || null,
      accountName: accountName || null,
      cryptoType: cryptoType || null,
      walletAddress: walletAddress || null,
      network: network || null,
      label: label || (type==='bank'? (bankName||'Bank account') : (cryptoType||'Crypto wallet')),
      createdAt: new Date()
    });

    res.json({ success: true, id: doc.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// List accounts
router.get('/', verifyUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const snap = await db.collection('users').doc(userId).collection('accounts').orderBy('createdAt','desc').get();
    const accounts = snap.docs.map(d=>({ id: d.id, ...d.data() }));
    res.json(accounts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Delete account
router.delete('/:id', verifyUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    await db.collection('users').doc(userId).collection('accounts').doc(req.params.id).delete();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get single account by id (for withdrawal selection)
router.get('/:id', verifyUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const doc = await db.collection('users').doc(userId).collection('accounts').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
