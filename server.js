require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const db = require('./db'); // PostgreSQL connection
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET));

const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (mongoUri) {
  mongoose.set('strictQuery', false);
  mongoose.connect(mongoUri)
    .then(() => { console.log('✅ Connected to MongoDB'); })
    .catch(err => { console.error('❌ MongoDB connection error:', err); });
} else {
  console.warn('⚠️ MONGODB_URI / MONGO_URI is not set. MongoDB features will not work until you add it to Render or .env');
}

// Native MongoDB helper (for earnings + transactions)
const mongoNative = require('./mongodb');
mongoNative.connectDB().catch(err => { /* already logged in module */ });

const { auth: firebaseAuth } = require('./config/firebaseAdmin');
const authMiddleware = require('./middleware/auth');
const User = require('./models/User');

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

// /api/balance handled later (supports token-based native Mongo lookup)


// GET /api/ad-check - Check if user should see aclib ad (100 seconds interval)
app.get('/api/ad-check', async (req, res) => {
  const email = req.query.email || (req.user && req.user.email) || null;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required', shouldShow: false });
  }

  try {
    const now = new Date();
    const AD_INTERVAL_MS = 100 * 1000; // 100 seconds

    // Check MongoDB if connected
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      const user = await User.findOne({ email: email.toLowerCase() });
      
      let shouldShow = false;
      if (!user || !user.lastAdShowTime) {
        shouldShow = true; // First time
      } else {
        const timeSinceLastAd = now - new Date(user.lastAdShowTime);
        shouldShow = timeSinceLastAd >= AD_INTERVAL_MS;
      }

      if (shouldShow) {
        await User.findOneAndUpdate(
          { email: email.toLowerCase() },
          { lastAdShowTime: now },
          { upsert: true, new: true }
        );
      }

      return res.json({
        shouldShow,
        sessionId: 'ad_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        email: email.toLowerCase()
      });
    }

    // Fallback to JSON file storage
    const usersPath = path.join(DATA_DIR, 'users.json');
    let users = [];
    try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8')); } catch (e) { users = []; }

    const normalized = email.toLowerCase();
    let user = users.find(u => (u.email || '').toLowerCase() === normalized);
    
    let shouldShow = false;
    if (!user) {
      user = { id: 'u_' + Date.now(), uid: 'u_' + Date.now(), email: normalized, displayName: '', balance: 0, lastAdShowTime: now.toISOString() };
      users.push(user);
      shouldShow = true;
    } else {
      const lastShowTime = user.lastAdShowTime ? new Date(user.lastAdShowTime) : new Date(0);
      const timeSinceLastAd = now - lastShowTime;
      shouldShow = timeSinceLastAd >= AD_INTERVAL_MS;
      if (shouldShow) {
        user.lastAdShowTime = now.toISOString();
      }
    }

    if (shouldShow) {
      fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
    }

    return res.json({
      shouldShow,
      sessionId: 'ad_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      email: normalized
    });
  } catch (err) {
    console.error('Error in /api/ad-check:', err);
    return res.status(500).json({ error: 'Internal server error', shouldShow: false });
  }
});

// ============================
// POST /api/earn - small frontend trigger to credit $0.01 (requires Firebase token)
// ============================
app.post('/api/earn', authMiddleware, async (req, res) => {
  try {
    const email = (req.user && req.user.email) || (req.body && req.body.email);
    if (!email) return res.status(400).json({ error: 'Email required' });

    const cleanEmail = String(email).toLowerCase().trim();
    const amount = 0.01;

    const usersColl = mongoNative.getUsersCollection();
    const txColl = mongoNative.getTransactionsCollection();

    await usersColl.updateOne(
      { email: cleanEmail },
      { $inc: { balance: amount, totalEarned: amount, fromSurveys: amount }, $setOnInsert: { email: cleanEmail, createdAt: new Date() } },
      { upsert: true }
    );

    await txColl.insertOne({ email: cleanEmail, type: 'earn', source: 'survey', amount, createdAt: new Date() });

    const user = await usersColl.findOne({ email: cleanEmail });
    res.json({ success: true, balance: user.balance });
  } catch (err) {
    console.error('/api/earn error', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================
// Update GET /api/balance to support Firebase token in Authorization header
// (backwards compatible with ?email=... query)
// ============================
app.get('/api/balance', async (req, res) => {
  try {
    let email = req.query.email;

    // If Authorization header present, verify token and use token email
    const authHeader = req.headers.authorization;
    if (!email && authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = await firebaseAuth.verifyIdToken(token);
        email = decoded.email;
      } catch (e) {
        // ignore - fall back to query param
      }
    }

    if (!email) return res.status(400).json({ error: 'Email required' });

    const cleanEmail = String(email).toLowerCase().trim();
    const usersColl = mongoNative.getUsersCollection();
    const user = await usersColl.findOne({ email: cleanEmail });

    res.json({ balance: (user && user.balance) || 0, totalEarned: (user && user.totalEarned) || 0 });
  } catch (err) {
    console.error('Error in /api/balance (native):', err);
    return res.status(500).json({ error: 'Internal server error' });
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

// CPAGrip server-to-server postback handler (MongoDB with Mongoose)
// Expected query params: subid (email), payout, secret
// CPAGrip server-to-server postback handler (native Mongo)
// Expected query params: subid (email), payout, secret
app.get('/postback/cpagrip', async (req, res) => {
  const { subid, payout, secret } = req.query;

  // Security check
  if (secret !== process.env.CPAGRIP_SECRET) {
    console.warn('Invalid CPAGRIP secret on postback');
    return res.status(403).send('Invalid Secret');
  }

  const amount = parseFloat(payout);
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).send('Invalid payout amount');
  }

  try {
    const usersColl = mongoNative.getUsersCollection();
    const txColl = mongoNative.getTransactionsCollection();

    const cleanEmail = String(subid || '').toLowerCase().trim();

    await usersColl.updateOne(
      { email: cleanEmail },
      { $inc: { balance: amount, totalEarned: amount, fromCPA: amount }, $setOnInsert: { email: cleanEmail, createdAt: new Date() } },
      { upsert: true }
    );

    await txColl.insertOne({ email: cleanEmail, type: 'earn', source: 'CPA', amount: amount, createdAt: new Date() });

    console.log(`✅ Credited $${amount} to ${cleanEmail} (CPAGrip)`);
    res.send('OK'); // CPAGrip expects OK
  } catch (err) {
    console.error('❌ CPAGrip postback error:', err);
    res.status(500).send('Error');
  }
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

// CREDIT USER FOR WATCHING AD - 5 PER DAY LIMIT + COOKIE CHECK
app.post('/api/credit-ad', async (req, res) => {
  const { email } = req.body;
  const userCookie = req.signedCookies && req.signedCookies.adWatch; // signed cookie check
  const userIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!email) return res.status(400).json({ error: 'Email required' });

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);

  try {
    // 1. COOKIE CHECK: 1 browser = 5 ads per day max
    if (userCookie) {
      let cookieData = {};
      try { cookieData = JSON.parse(userCookie); } catch (e) { cookieData = {}; }
      if (cookieData.date === today.toISOString().split('T')[0] && cookieData.count >= 5) {
        return res.status(429).json({ error: 'This browser reached 5 ads today' });
      }
    }

    // Find user in Mongo if available
    let user = null;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      user = await User.findOne({ email: (email || '').toLowerCase() });
    } else {
      // fallback to JSON file users
      const usersPath = path.join(DATA_DIR, 'users.json');
      try { const users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); user = users.find(u => (u.email || '').toLowerCase() === (email || '').toLowerCase()); } catch (e) { user = null; }
    }

    // 2. 1min cooldown (use 30min threshold from original code)
    if (user && user.lastAd && new Date(user.lastAd) > thirtyMinAgo) {
      return res.status(429).json({ error: 'Wait 1 minutes between ads' });
    }

    // 3. DAILY RESET
    let adsWatchedToday = user?.adsWatchedToday || 0;
    let lastReset = user?.lastReset ? new Date(user.lastReset) : new Date(0);
    if (lastReset < today) adsWatchedToday = 0;

    // 4. 5 PER DAY EMAIL LIMIT
    if (adsWatchedToday >= 5) {
      return res.status(429).json({ error: 'Daily limit of 5 ads reached' });
    }

    // 5. CREDIT USER (store balance in cents to avoid float issues)
    let result = null;
    if (mongoose.connection && mongoose.connection.readyState === 1) {
      result = await User.findOneAndUpdate(
        { email: (email || '').toLowerCase() },
        {
          $inc: { balance: 1, adsWatchedToday: 1 }, // 1 cent
          $set: { lastAd: now.toISOString(), lastReset: today.toISOString().split('T')[0], lastIP: userIP }
        },
        { upsert: true, returnDocument: 'after' }
      );
    } else {
      // update JSON fallback
      const usersPath = path.join(DATA_DIR, 'users.json');
      let users = [];
      try { users = JSON.parse(fs.readFileSync(usersPath, 'utf8') || '[]'); } catch (e) { users = []; }
      const normalized = (email || '').toLowerCase();
      let u = users.find(u => (u.email || '').toLowerCase() === normalized);
      if (!u) {
        u = { id: 'u_' + Date.now(), uid: 'u_' + Date.now(), email: normalized, displayName: '', balance: 1, adsWatchedToday: 1, lastAd: now.toISOString(), lastReset: today.toISOString().split('T')[0], lastIP: userIP };
        users.push(u);
      } else {
        u.balance = (u.balance || 0) + 1;
        u.adsWatchedToday = (u.adsWatchedToday || 0) + 1;
        u.lastAd = now.toISOString();
        u.lastReset = today.toISOString().split('T')[0];
        u.lastIP = userIP;
      }
      fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
      result = { value: u };
    }

    // 6. SET COOKIE: 24hr expiry
    let newCookieCount = 1;
    if (userCookie) {
      try {
        const cookieData = JSON.parse(userCookie);
        if (cookieData.date === today.toISOString().split('T')[0]) {
          newCookieCount = (cookieData.count || 0) + 1;
        }
      } catch (e) {}
    }
    res.cookie('adWatch', JSON.stringify({
      count: newCookieCount,
      date: today.toISOString().split('T')[0]
    }), {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      signed: true
    });

    res.json({
      success: true,
      newBalance: ((result.value && result.value.balance) || 0) / 100,
      adsLeft: 5 - ((result.value && result.value.adsWatchedToday) || 0),
      cookieAdsLeft: 5 - newCookieCount
    });
  } catch (err) {
    console.error('Error in /api/credit-ad:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Auto-tag ad gate throttle: show once every 100 seconds per user/email
const AUTO_TAG_INTERVAL_MS = 100000;
const AUTO_TAG_PATH = path.join(DATA_DIR, 'auto-tag.json');

function readAutoTagState() {
  try {
    const raw = fs.readFileSync(AUTO_TAG_PATH, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
}

function writeAutoTagState(state) {
  fs.writeFileSync(AUTO_TAG_PATH, JSON.stringify(state, null, 2));
}

function getAutoTagKey(req) {
  const email = (req.headers['x-user-email'] || req.body?.email || '').toString().trim().toLowerCase();
  if (email) return `email:${email}`;
  const forwarded = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString();
  const ip = forwarded.split(',')[0].trim() || 'unknown';
  return `ip:${ip}`;
}

app.get('/api/auto-tag/status', (req, res) => {
  const key = getAutoTagKey(req);
  const now = Date.now();
  const state = readAutoTagState();
  const lastShown = Number(state[key] || 0);

  res.json({
    show: !lastShown || (now - lastShown >= AUTO_TAG_INTERVAL_MS)
  });
});

app.post('/api/auto-tag/mark-shown', (req, res) => {
  const key = getAutoTagKey(req);
  const state = readAutoTagState();
  state[key] = Date.now();
  writeAutoTagState(state);
  res.json({ ok: true });
});

// ✅ Middleware
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
