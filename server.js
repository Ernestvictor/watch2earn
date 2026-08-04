// server.js
const express = require('express');
const db = require('./db');
const app = express();

app.use(express.json());

// Example route: create a withdrawal
app.post('/withdraw', async (req, res) => {
  const { userId, amount } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO withdrawals (userId, amount) VALUES ($1, $2) RETURNING *',
      [userId, amount]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error creating withdrawal");
  }
});

// Example route: list withdrawals
app.get('/withdrawals', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM withdrawals');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching withdrawals");
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
