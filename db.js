// db.js
const { Pool } = require('pg');

// Render automatically provides DATABASE_URL when you add a Postgres instance
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // required for Render Postgres
});

// Create withdrawals table if it doesn't exist
pool.query(`
  CREATE TABLE IF NOT EXISTS withdrawals (
    id SERIAL PRIMARY KEY,
    userId TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    status TEXT DEFAULT 'pending'
  )
`).catch(err => console.error("Error creating table:", err));

module.exports = pool;
