const express = require('express');
const router = express.Router();

// Firebase login is handled client-side, so backend just provides placeholders
router.post('/login', (req, res) => {
  res.json({ message: 'Login handled on frontend with Firebase' });
});

router.post('/logout', (req, res) => {
  res.json({ message: 'Logout handled on frontend with Firebase' });
});

module.exports = router;
