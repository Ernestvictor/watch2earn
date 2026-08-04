require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

// Import SQLite database
const db = require('./db'); // make sure you created db.js with sqlite3 setup

// Middleware
const { verifyToken } = require('./middleware/auth');
const fraudCheck = require('./middleware/fraudCheck');

// Routes (you’ll gradually rewrite these to use SQLite instead of Mongoose)
const authRoutes = require('./routes/auth');
const withdrawalRoutes = require('./routes/withdrawals');
const transactionRoutes = require('./routes/transactions');
const adminRoutes = require('./routes/admin');

const app = express();
app.use(cors());
app.use(helmet());
app.use(express.json());
app.use(morgan('combined'));

// Example SQLite route: create user
app.post('/api/users', (req, res) => {
  const { id, email, balanceUsd } = req.body;
  db.run(
    `INSERT INTO users (id, email, balanceUsd) VALUES (?, ?, ?)`,
    [id, email, balanceUsd],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'User created successfully', id });
    }
  );
});

// Other routes (still using middleware, but you’ll adapt them to SQLite)
app.use('/api/auth', authRoutes);
app.use('/api/withdrawals', verifyToken, fraudCheck, withdrawalRoutes);
app.use('/api/transactions', verifyToken, transactionRoutes);
app.use('/api/admin', adminRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
