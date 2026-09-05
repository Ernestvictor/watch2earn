require('dotenv').config();

// ✅ STARTUP VALIDATION: Fail fast if critical env vars are missing
const requiredEnvVars = [
  'MONGODB_URI',
  'JWT_SECRET',
  'COOKIE_SECRET',
  'FIREBASE_PROJECT_ID'
];

const missingEnv = requiredEnvVars.filter(env => !process.env[env]);
if (missingEnv.length > 0) {
  console.error('❌ FATAL: Missing required environment variables:');
  missingEnv.forEach(env => console.error(`   - ${env}`));
  console.error('\nPlease set these in your .env file or deployment environment.');
  process.exit(1);
}

const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET));

// ✅ Connect to MongoDB (required)
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
const mongoDbName = process.env.MONGO_DB_NAME || process.env.DB_NAME || 'watch2earn';
mongoose.set('strictQuery', false);
mongoose.connect(mongoUri, { dbName: mongoDbName })
  .then(() => { console.log(`✅ Connected to MongoDB (Mongoose): ${mongoDbName}`); })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// Native MongoDB helper (for earnings + transactions)
const mongoNative = require('./mongodb');
// connect to mongo and optionally run migration if requested
mongoNative.connectDB().then(() => {
  console.log('ℹ️ mongoNative connected from server.js');
  if (process.env.MIGRATE_ON_STARTUP && process.env.MIGRATE_ON_STARTUP.toLowerCase() === 'true') {
    console.log('ℹ️ MIGRATE_ON_STARTUP=true — running migration script now');
    try {
      const migrator = require('./scripts/migrate_to_mongo');
      migrator.migrate().catch(e => console.error('Migration error:', e && e.message));
    } catch (e) {
      console.error('Failed to run migration script:', e && e.message);
    }
  }
}).catch(err => { /* already logged in module */ });

const authMiddleware = require('./middleware/auth');
const User = require('./models/users');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const referralsRoutes = require('./routes/referrals');
const transactionsRoutes = require('./routes/transactions');
const withdrawalsRoutes = require('./routes/withdrawals');
const accountsRoutes = require('./routes/accounts');
const bonusRoutes = require('./routes/bonus');
const adsRoutes = require('./routes/ads');
const earningRoutes = require('./routes/earning');
const cpxRoutes = require('./routes/cpx');

// ✅ Serve static frontend files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Mount API route handlers
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/referrals', referralsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/withdrawals', withdrawalsRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/bonus', bonusRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/earning', earningRoutes);
app.use('/api/cpx', cpxRoutes);

// ✅ Serve ads.txt from project root for ad verification sources
app.get('/ads.txt', (req, res) => {
  const adsPath = path.join(__dirname, 'ads.txt');

  if (!fs.existsSync(adsPath)) {
    return res.status(404).type('text/plain').send('ads.txt not found');
  }

  res.type('text/plain');
  res.sendFile(adsPath);
});

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

// ✅ Message inbox endpoint (MongoDB only)
app.get('/api/messages', async (req, res) => {
  try {
    const messagesCollection = mongoNative.getCollection('admin_messages');
    const messages = await messagesCollection.find({}).sort({ createdAt: -1 }).limit(50).toArray();
    res.json(messages || []);
  } catch (err) {
    console.error('Error fetching messages:', err);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

app.get('/api/user/announcements', async (req, res) => {
  try {
    const messagesCollection = mongoNative.getCollection('admin_messages');
    const messages = await messagesCollection.find({}).sort({ createdAt: -1 }).limit(50).toArray();
    const latest = messages[0] || { message: 'Welcome back to Watch2Earn!' };
    res.json({
      messages,
      announcement: latest.message || 'Welcome back to Watch2Earn!'
    });
  } catch (err) {
    console.error('Error fetching announcements:', err);
    res.json({
      messages: [],
      announcement: 'Welcome back to Watch2Earn!'
    });
  }
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


// GET /api/ad-check - Check if user should see aclib ad (100 seconds interval) - MongoDB only
app.get('/api/ad-check', async (req, res) => {
  const email = req.query.email || (req.user && req.user.email) || null;
  
  if (!email) {
    return res.status(400).json({ error: 'Email required', shouldShow: false });
  }

  try {
    const now = new Date();
    const AD_INTERVAL_MS = 100 * 1000; // 100 seconds
    const normalizedEmail = email.toLowerCase();

    const user = await User.findOne({ email: normalizedEmail });
    
    let shouldShow = false;
    if (!user || !user.lastAdShowTime) {
      shouldShow = true; // First time
    } else {
      const timeSinceLastAd = now - new Date(user.lastAdShowTime);
      shouldShow = timeSinceLastAd >= AD_INTERVAL_MS;
    }

    if (shouldShow) {
      await User.findOneAndUpdate(
        { email: normalizedEmail },
        { lastAdShowTime: now },
        { upsert: true, new: true }
      );
    }

    return res.json({
      shouldShow,
      sessionId: 'ad_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      email: normalizedEmail
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

app.get('/claim', authMiddleware, async (req, res) => {
  try {
    const firebaseUid = req.user && (req.user.uid || req.user.user_id || req.user.sub);
    const email = req.user && req.user.email ? String(req.user.email).toLowerCase().trim() : null;
    if (!firebaseUid) {
      return res.status(400).json({ error: 'Invalid Firebase user token' });
    }

    const rewardUsd = Number(process.env.TELEGRAM_CLAIM_REWARD_USD || 0.1);
    const rewardNaira = Math.round(rewardUsd * 1500);

    let user = await User.findOne({
      $or: [
        { firebaseUid },
        { uid: firebaseUid },
        { id: firebaseUid },
        ...(email ? [{ email }] : [])
      ]
    });

    if (!user) {
      user = await User.create({
        firebaseUid,
        email: email || `${firebaseUid}@telegram.local`,
        username: req.user.name || req.user.email || 'Telegram User',
        displayName: req.user.name || req.user.email || 'Telegram User',
        balance: rewardUsd,
        totalEarned: rewardUsd,
        coins: rewardNaira,
        status: 'active'
      });
    } else {
      user.balance = Number(user.balance || 0) + rewardUsd;
      user.totalEarned = Number(user.totalEarned || 0) + rewardUsd;
      user.coins = Number(user.coins || 0) + rewardNaira;
      if (email && !user.email) user.email = email;
      await user.save();
    }

    // Records transaction in MongoDB
    const transactionsColl = mongoNative.getTransactionsCollection();
    await transactionsColl.insertOne({
      userId: firebaseUid,
      email: email || null,
      type: 'telegram_bonus',
      source: 'telegram_channel',
      title: 'Telegram Channel Bonus',
      amountUsd: rewardUsd,
      amountNaira: rewardNaira,
      createdAt: new Date()
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error('Error claiming Telegram reward:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// CPX server-to-server postback handler (MongoDB with Mongoose)
// Expected query params: trans_id, user_id, amount_usd, status, secret
app.get('/postback/cpx', async (req, res) => {
  const { trans_id, user_id, amount_usd, status, secret } = req.query;

  // Security check
  if (secret !== process.env.CPX_SECRET) {
    console.warn('Invalid CPX secret on postback');
    return res.status(403).send('Invalid Secret');
  }

  if (status === '1') {
    // Completed - credit earnings (MongoDB only)
    const amountUsd = parseFloat(amount_usd || 0);
    const amountNaira = Math.round(amountUsd * 1500);
    try {
      const txColl = mongoNative.getTransactionsCollection();
      await txColl.insertOne({
        id: trans_id,
        userId: user_id,
        type: 'survey',
        source: 'cpx',
        title: 'CPX Survey Completed',
        amountUsd: amountUsd,
        amountNaira: amountNaira,
        createdAt: new Date(),
        cpxTransId: trans_id
      });
      console.log(`✅ Credited ₦${amountNaira} ($${amountUsd}) to user ${user_id} for CPX survey`);
    } catch (err) {
      console.error('CPX transaction failed:', err.message);
    }
  } else if (status === '2') {
    // Reversed - remove earnings (MongoDB only)
    const amountUsd = parseFloat(amount_usd || 0);
    const amountNaira = Math.round(amountUsd * 1500);
    try {
      const txColl = mongoNative.getTransactionsCollection();
      await txColl.insertOne({
        id: trans_id + '_reversed',
        userId: user_id,
        type: 'survey_reversal',
        source: 'cpx',
        title: 'CPX Survey Reversed',
        amountUsd: -amountUsd,
        amountNaira: -amountNaira,
        createdAt: new Date(),
        cpxTransId: trans_id
      });
      console.log(`⚠️ Reversed ₦${amountNaira} ($${amountUsd}) from user ${user_id}`);
    } catch (err) {
      console.error('CPX reversal failed:', err.message);
    }
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
      { $inc: { balance: amount, totalEarned: amount, fromCPA: amount }, $setOnInsert: { email: cleanEmail, createdAt: new Date(), uid: 'u_' + Date.now() } },
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

// POST /cpagrip-postback - receive lightweight tracking beacons from client (MongoDB only)
app.post('/cpagrip-postback', express.json(), async (req, res) => {
  try {
    const payload = req.body || {};
    const userId = payload.userId || payload.user_id || null;
    const email = payload.email || null;
    const extUrl = payload.extUrl || null;

    // Save/update user email in MongoDB
    if (email || userId) {
      const usersColl = mongoNative.getUsersCollection();
      await usersColl.updateOne(
        email ? { email: email.toLowerCase() } : { _id: userId },
        { $set: { ...(email && { email: email.toLowerCase() }), lastSeenAt: new Date() } },
        { upsert: true }
      );
    }

    // Record lightweight tracking transaction in MongoDB
    if (userId || email) {
      const txColl = mongoNative.getTransactionsCollection();
      await txColl.insertOne({
        userId: userId || null,
        email: email ? email.toLowerCase() : null,
        type: 'cpagrip_click',
        source: 'cpagrip',
        meta: { extUrl },
        createdAt: new Date()
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('cpagrip-postback error', err);
    res.status(500).json({ error: 'server error' });
  }
});

// CREDIT USER FOR WATCHING AD - 5 PER DAY LIMIT + COOKIE CHECK (MongoDB only)
app.post('/api/credit-ad', async (req, res) => {
  const { email } = req.body;
  const userCookie = req.signedCookies && req.signedCookies.adWatch;
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

    // 2. Find user in MongoDB
    const normalizedEmail = (email || '').toLowerCase();
    let user = await User.findOne({ email: normalizedEmail });

    // 3. 30min cooldown between ads
    if (user && user.lastAd && new Date(user.lastAd) > thirtyMinAgo) {
      return res.status(429).json({ error: 'Wait 30 minutes between ads' });
    }

    // 4. DAILY RESET
    let adsWatchedToday = user?.adsWatchedToday || 0;
    let lastReset = user?.lastReset ? new Date(user.lastReset) : new Date(0);
    if (lastReset < today) adsWatchedToday = 0;

    // 5. 5 PER DAY EMAIL LIMIT
    if (adsWatchedToday >= 5) {
      return res.status(429).json({ error: 'Daily limit of 5 ads reached' });
    }

    // 6. CREDIT USER
    const result = await User.findOneAndUpdate(
      { email: normalizedEmail },
      {
        $inc: { balance: 0.01, adsWatchedToday: 1 },
        $set: { lastAd: now, lastReset: today, lastIP: userIP }
      },
      { upsert: true, returnDocument: 'after' }
    );

    // 7. SET COOKIE: 24hr expiry
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
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'Lax',
      secure: true,
      signed: true
    });

    res.json({
      success: true,
      newBalance: (result?.balance || 0),
      adsLeft: 5 - ((result?.adsWatchedToday) || 0),
      cookieAdsLeft: 5 - newCookieCount
    });
  } catch (err) {
    console.error('Error in /api/credit-ad:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Auto-tag ad gate throttle: show once every 100 seconds per user/email (MongoDB only)
const AUTO_TAG_INTERVAL_MS = 100000;

app.get('/api/auto-tag/status', async (req, res) => {
  try {
    const email = (req.headers['x-user-email'] || req.body?.email || '').toString().trim().toLowerCase();
    const key = email || ((req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim());
    
    if (!key) {
      return res.json({ show: true });
    }

    const autoTagCollection = mongoNative.getCollection('auto_tag_throttle');
    const record = await autoTagCollection.findOne({ key });
    const now = Date.now();
    const lastShown = record?.lastShown || 0;

    res.json({
      show: !lastShown || (now - lastShown >= AUTO_TAG_INTERVAL_MS)
    });
  } catch (err) {
    console.error('Error in /api/auto-tag/status:', err);
    res.json({ show: true }); // Fail open
  }
});

app.post('/api/auto-tag/mark-shown', async (req, res) => {
  try {
    const email = (req.headers['x-user-email'] || req.body?.email || '').toString().trim().toLowerCase();
    const key = email || ((req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim());
    
    if (!key) {
      return res.json({ ok: false });
    }

    const autoTagCollection = mongoNative.getCollection('auto_tag_throttle');
    await autoTagCollection.updateOne({ key }, { $set: { lastShown: Date.now() } }, { upsert: true });
    res.json({ ok: true });
  } catch (err) {
    console.error('Error in /api/auto-tag/mark-shown:', err);
    res.status(500).json({ error: 'server error' });
  }
});

// ✅ Middleware
const fraudCheck = require('./middleware/fraudcheck');

// ✅ Admin panel entry routes
app.get('/admin-panel', (req, res) => {
  res.redirect('/admin-panel/carbinate.html');
});

app.get('/admin-panel/', (req, res) => {
  res.redirect('/admin-panel/carbinate.html');
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
