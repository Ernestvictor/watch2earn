// server.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('./db'); // PostgreSQL connection
const app = express();

app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_PATH = path.join(DATA_DIR, 'messages.json');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MESSAGES_PATH)) fs.writeFileSync(MESSAGES_PATH, '[]');
  if (!fs.existsSync(SETTINGS_PATH)) fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ dailyAdLimit: 5, bonusAdCount: 0, lastAnnouncement: '' }, null, 2));
}

function readMessages() {
  ensureDataFiles();
  try { return JSON.parse(fs.readFileSync(MESSAGES_PATH, 'utf8')); } catch (e) { return []; }
}

function readSettings() {
  ensureDataFiles();
  try { return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')); } catch (e) { return { dailyAdLimit: 5, bonusAdCount: 0, lastAnnouncement: '' }; }
}

// ✅ Serve static frontend files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Root route → signin page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ✅ Home page after signup
app.get('/home', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// ✅ Admin login verification (inside public/admin-panel/)
app.get('/verify', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-panel', 'verify.html'));
});

// ✅ Admin home (carbinate, inside public/admin-panel/)
app.get('/carbinate', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-panel', 'carbinate.html'));
});

// ✅ Message inbox endpoint used by public/messege.html
app.get('/api/messages', (req, res) => {
  res.json(readMessages());
});

app.get('/api/user/announcements', (req, res) => {
  const messages = readMessages();
  const settings = readSettings();
  const latest = messages[0] || { message: settings.lastAnnouncement || 'Welcome back to Watch2Earn!' };
  res.json({
    messages,
    announcement: latest.message || settings.lastAnnouncement || 'Welcome back to Watch2Earn!'
  });
});

// Serve ads.json from project root so the frontend can fetch live ads
app.get('/api/ads', (req, res) => {
  const adsPath = path.join(__dirname, 'ads.json');
  try {
    const raw = fs.readFileSync(adsPath, 'utf8');
    const json = JSON.parse(raw || '[]');
    res.json(json);
  } catch (e) {
    res.json([]);
  }
});

// ✅ Example API route: create a withdrawal
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
    res.status(500).send('Error creating withdrawal');
  }
});

// ✅ Example API route: list withdrawals
app.get('/withdrawals', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM withdrawals');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error fetching withdrawals');
  }
});

// ✅ Mount backend routes
const accountRoutes = require('./routes/accounts');
const adminRoutes = require('./routes/admin');
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const userRoutes = require('./routes/users');
const withdrawalRoutes = require('./routes/withdrawals');
const adsRoutes = require('./routes/ads');
const referralsRoutes = require('./routes/referrals');

app.use('/api/admin', adminRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/referrals', referralsRoutes);

// ✅ Middleware
const authMiddleware = require('./middleware/auth');
const fraudCheck = require('./middleware/fraudcheck');

// ✅ Admin panel entry routes
app.get('/admin-panel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-panel', 'verify.html'));
});

app.get('/admin-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-panel', 'carbinate.html'));
});

app.get('/admin-dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-panel', 'carbinate.html'));
});

app.get('/logout', (req, res) => {
  res.clearCookie('adminToken');
  res.redirect('/admin-panel');
});

// ✅ Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

const net = require('net');

async function findAvailablePort(startPort, maxOffset = 10) {
  for (let i = 0; i <= maxOffset; i++) {
    const port = Number(startPort) + i;
    // try to bind a temporary server
    const ok = await new Promise((resolve) => {
      const tester = net.createServer()
        .once('error', () => resolve(false))
        .once('listening', () => tester.close(() => resolve(true)))
        .listen(port);
    });
    if (ok) return port;
  }
  return Number(startPort);
}

(async () => {
  const desired = process.env.PORT || 5000;
  const port = await findAvailablePort(desired, 20);
  app.listen(port, () => {
    if (Number(desired) !== Number(port)) {
      console.warn(`Port ${desired} was in use — started server on available port ${port}`);
    }
    console.log(`Server running on port ${port}`);
  });
})();
