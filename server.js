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
const cpxRoutes = require('./routes/cpx');

app.use('/api/admin', adminRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/referrals', referralsRoutes);
app.use('/api/cpx', cpxRoutes);

// ✅ CPX Postback Handler (direct route for CPX callbacks)
const crypto = require('crypto');

const CPX_SECURE_KEY = "CTJ6jPqHw1T80G7qCTxG6AjE72aadXzE";

function loadCpxTracking() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cpx-tracking.json'), 'utf8')); } catch (e) { return []; }
}

function saveCpxTracking(items) {
  fs.writeFileSync(path.join(DATA_DIR, 'cpx-tracking.json'), JSON.stringify(items, null, 2));
}

function loadTransactions() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'transactions.json'), 'utf8')); } catch (e) { return []; }
}

function saveTransactions(items) {
  fs.writeFileSync(path.join(DATA_DIR, 'transactions.json'), JSON.stringify(items, null, 2));
}

app.get('/cpx-postback', (req, res) => {
  const { status, trans_id, user_id, amount_usd, amount_local, hash } = req.query;

  console.log('✅ CPX Postback received:', { status, trans_id, user_id, amount_usd, hash });

  // Verify hash to prevent fraud
  const checkString = status + trans_id + user_id + amount_usd + CPX_SECURE_KEY;
  const myHash = crypto.createHash('md5').update(checkString).digest('hex');

  if (myHash !== hash) {
    console.log('❌ Hash mismatch! Expected:', myHash, 'Received:', hash);
    return res.status(403).send('Invalid Hash');
  }

  // Prevent double payment
  const tracking = loadCpxTracking();
  if (tracking.find(t => t.trans_id === trans_id)) {
    console.log('⚠️ trans_id already processed:', trans_id);
    return res.send('OK - Already Processed');
  }

  // Status 1 = Completed, 2 = Reversed
  if (status === '1') {
    const amountUsd = parseFloat(amount_usd || 0);
    const amountNaira = Math.round(amountUsd * 1500);

    const transactions = loadTransactions();
    const newTx = {
      id: trans_id,
      userId: user_id,
      type: 'survey',
      source: 'cpx',
      title: 'CPX Survey Completed',
      amountUsd: amountUsd,
      amountNaira: amountNaira,
      date: new Date().toISOString(),
      cpxTransId: trans_id
    };

    transactions.unshift(newTx);
    saveTransactions(transactions);

    // Track this trans_id
    tracking.push({
      trans_id: trans_id,
      user_id: user_id,
      amount_usd: amountUsd,
      status: 'completed',
      date: new Date().toISOString()
    });
    saveCpxTracking(tracking);

    console.log(`✅ Credited ₦${amountNaira} ($${amountUsd}) to user ${user_id} for CPX survey`);
  } else if (status === '2') {
    // Reversed - remove earnings
    const amountUsd = parseFloat(amount_usd || 0);
    const amountNaira = Math.round(amountUsd * 1500);

    const transactions = loadTransactions();
    const reversal = {
      id: trans_id + '_reversed',
      userId: user_id,
      type: 'survey_reversal',
      source: 'cpx',
      title: 'CPX Survey Reversed',
      amountUsd: -amountUsd,
      amountNaira: -amountNaira,
      date: new Date().toISOString(),
      cpxTransId: trans_id
    };

    transactions.unshift(reversal);
    saveTransactions(transactions);

    // Track reversal
    const idx = tracking.findIndex(t => t.trans_id === trans_id);
    if (idx !== -1) {
      tracking[idx].status = 'reversed';
      tracking[idx].reversedAt = new Date().toISOString();
    }
    saveCpxTracking(tracking);

    console.log(`⚠️ Reversed ₦${amountNaira} ($${amountUsd}) from user ${user_id}`);
  }

  // MUST return 'OK' or CPX will retry
  res.send('OK');
});

// POST /cpagrip-postback - receive lightweight tracking beacons from client
app.post('/cpagrip-postback', express.json(), (req, res) => {
  try {
    const payload = req.body || {};
    const userId = payload.userId || payload.user_id || null;
    const email = payload.email || null;
    const extUrl = payload.extUrl || null;

    // Save/update user email in data/users.json
    try {
      const usersPath = path.join(DATA_DIR, 'users.json');
      let users = [];
      try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8')); } catch (e) { users = []; }

      let user = null;
      if (userId) user = users.find(u => u.id === userId || u.uid === userId);
      if (!user && email) user = users.find(u => (u.email || '').toLowerCase() === (email || '').toLowerCase());

      if (user) {
        if (email && !user.email) {
          user.email = email;
          fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
          console.log('Updated user email for', userId || email);
        }
      } else if (userId || email) {
        const newUser = { id: userId || ('u_' + Date.now()), uid: userId || ('u_' + Date.now()), email: email || '', displayName: '' };
        users.push(newUser);
        fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
        console.log('Created new user record from cpagrip beacon', newUser.id);
      }
    } catch (e) {
      console.error('Failed to update users.json from cpagrip beacon', e);
    }

    // Optionally, record a lightweight tracking transaction
    try {
      const txPath = path.join(DATA_DIR, 'transactions.json');
      let txs = [];
      try { txs = JSON.parse(fs.readFileSync(txPath, 'utf8')); } catch (e) { txs = []; }
      const tx = { id: 'cpagrip_' + Date.now(), userId: userId || null, type: 'cpagrip_click', source: 'cpagrip', meta: { extUrl }, date: new Date().toISOString() };
      txs.unshift(tx);
      fs.writeFileSync(txPath, JSON.stringify(txs, null, 2));
    } catch (e) {
      console.error('Failed to write cpagrip transaction', e);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('cpagrip-postback error', err);
    res.status(500).json({ error: 'server error' });
  }
});

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
