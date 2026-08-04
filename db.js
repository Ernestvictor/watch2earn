const sqlite3 = require('sqlite3').verbose();

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL,
  amount REAL NOT NULL,              -- withdrawal amount in Naira
  recipientCode TEXT NOT NULL,       -- Paystack recipient code
  status TEXT DEFAULT 'Pending',     -- Pending, Approved, Rejected
  date TEXT NOT NULL,                -- ISO timestamp
  FOREIGN KEY (userId) REFERENCES users(id)
);


// Create or open the database file
const db = new sqlite3.Database('./watch2earn.db', (err) => {
  if (err) {
    console.error('❌ Error opening database:', err.message);
  } else {
    console.log('✅ Connected to SQLite database');
  }
});

// Initialize tables if they don’t exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT,
    balanceUsd REAL,
    adsEarn REAL,
    gameEarn REAL,
    surveyEarn REAL,
    refEarn REAL,
    invitedCount INTEGER,
    announcement TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT,
    amount REAL,
    method TEXT,
    accountDetails TEXT,
    status TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT,
    type TEXT,
    amount REAL
  )`);
});

module.exports = db;
