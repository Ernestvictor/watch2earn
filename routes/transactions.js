const express = require('express');
const router = express.Router();
const db = require('../db'); // your SQLite setup
const { verifyToken } = require('../middleware/auth');

// Helper: get today’s date string (YYYY-MM-DD)
function todayString() {
  return new Date().toISOString().split('T')[0];
}

// POST /api/transactions/earn
router.post('/earn', verifyToken, (req, res) => {
  const { nairaAmount, source, title } = req.body;
  const userId = req.user.id; // from JWT

  // Check how many ads user watched today
  db.get(
    `SELECT COUNT(*) as count FROM transactions 
     WHERE userId=? AND type='ad' AND date(date)=?`,
    [userId, todayString()],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });

      if (row.count >= 5) {
        return res.status(403).json({ error: 'Daily ad limit reached (5)' });
      }

      // Convert naira to USD (example rate)
      const usdAmount = nairaAmount / 1500;

      // Insert transaction
      db.run(
        `INSERT INTO transactions (userId, type, source, title, amount, date) 
         VALUES (?, 'ad', ?, ?, ?, ?)`,
        [userId, source, title, usdAmount, new Date().toISOString()],
        function (err) {
          if (err) return res.status(500).json({ error: err.message });

          // Update user balance
          db.run(
            `UPDATE users SET balanceUsd = balanceUsd + ? WHERE id=?`,
            [usdAmount, userId],
            (err2) => {
              if (err2) return res.status(500).json({ error: err2.message });
              res.json({ message: 'Ad watched successfully', amount: usdAmount });
            }
          );
        }
      );
    }
  );
});

module.exports = router;
