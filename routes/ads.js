const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const auth = require('../middleware/auth');
const verifyToken = require('../middleware/auth');

const ADS_PATH = path.join(__dirname, '..', 'ads.json');
const TXN_PATH = path.join(__dirname, '..', 'data', 'transactions.json');
const USERS_PATH = path.join(__dirname, '..', 'data', 'users.json');
const DATA_DIR = path.join(__dirname, '..', 'data');

function ensureAdsFile(){
  try{ fs.mkdirSync(path.dirname(ADS_PATH), { recursive: true }); }catch(e){}
  if(!fs.existsSync(ADS_PATH)) fs.writeFileSync(ADS_PATH, '[]');
}

function ensureFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(TXN_PATH)) fs.writeFileSync(TXN_PATH, '[]');
  if (!fs.existsSync(USERS_PATH)) fs.writeFileSync(USERS_PATH, '[]');
}

function loadTransactions() {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(TXN_PATH, 'utf8')); } catch (e) { return []; }
}

function saveTransactions(items) {
  ensureFiles();
  fs.writeFileSync(TXN_PATH, JSON.stringify(items, null, 2));
}

function loadUsers() {
  ensureFiles();
  try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); } catch (e) { return []; }
}

function saveUsers(items) {
  ensureFiles();
  fs.writeFileSync(USERS_PATH, JSON.stringify(items, null, 2));
}

function isToday(value) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

// public: list ads
router.get('/', (req,res)=>{
  ensureAdsFile();
  try{ const data = JSON.parse(fs.readFileSync(ADS_PATH,'utf8')||'[]'); res.json(data); }
  catch(e){ res.json([]); }
});

// admin: create ad
router.post('/', auth, (req,res)=>{
  ensureAdsFile();
  const { id, title, seconds, type } = req.body;
  const ads = JSON.parse(fs.readFileSync(ADS_PATH,'utf8')||'[]');
  const ad = { id: id || ('ad_' + Date.now()), title: title || 'Untitled', seconds: Number(seconds) || 15, type: type || 'ad' };
  ads.unshift(ad);
  fs.writeFileSync(ADS_PATH, JSON.stringify(ads, null, 2));
  res.json(ad);
});

// admin: update ad
router.put('/:id', auth, (req,res)=>{
  ensureAdsFile();
  const ads = JSON.parse(fs.readFileSync(ADS_PATH,'utf8')||'[]');
  const idx = ads.findIndex(a=>a.id === req.params.id);
  if(idx === -1) return res.status(404).send('Not found');
  const updated = Object.assign(ads[idx], req.body);
  ads[idx] = updated;
  fs.writeFileSync(ADS_PATH, JSON.stringify(ads, null, 2));
  res.json(updated);
});

// admin: delete ad
router.delete('/:id', auth, (req,res)=>{
  ensureAdsFile();
  let ads = JSON.parse(fs.readFileSync(ADS_PATH,'utf8')||'[]');
  const before = ads.length;
  ads = ads.filter(a=>a.id !== req.params.id);
  fs.writeFileSync(ADS_PATH, JSON.stringify(ads, null, 2));
  res.json({ deleted: before - ads.length });
});

// POST /api/ads/watch - Watch an ad and earn money based on duration
// Body: { adDuration: number (seconds) }
router.post('/watch', verifyToken, (req, res) => {
  const { adDuration } = req.body;
  const userId = req.user.uid || req.user.id;
  
  if (!adDuration || typeof adDuration !== 'number') {
    return res.status(400).json({ error: 'Invalid ad duration' });
  }

  // Check daily ad limit (5 ads per day)
  const transactions = loadTransactions();
  const todaysAds = transactions.filter(t => 
    t.userId === userId && t.type === 'ad_watch' && isToday(t.date)
  );

  if (todaysAds.length >= 5) {
    return res.status(403).json({
      error: 'Daily ad limit reached (5/day)',
      message: 'You can watch 5 ads per day. Limit resets at 12:00 AM tomorrow',
      adsToday: 5,
      remaining: 0
    });
  }

  // Check if ad is 15+ seconds to approve payment
  let payment = 0; // in NGN
  if (adDuration >= 15) {
    payment = 2.00; // 2.00 NGN for watching 15+ second ad
  } else {
    return res.status(400).json({
      error: 'Ad too short',
      message: 'Video must be at least 15 seconds for payment',
      minDuration: 15,
      yourDuration: adDuration
    });
  }

  // Convert to USD
  const paymentUsd = +(payment / 1500).toFixed(6);

  // Record the ad watch transaction
  const adTx = {
    id: Date.now().toString(),
    userId,
    type: 'ad_watch',
    source: 'video_ad',
    title: `Watched ${adDuration}s ad`,
    amountUsd: paymentUsd,
    amountNaira: payment,
    adDuration,
    date: new Date().toISOString()
  };

  transactions.unshift(adTx);
  saveTransactions(transactions);

  // If user was referred, give referrer 10% commission
  const users = loadUsers();
  const user = users.find(u => u.id === userId || u.uid === userId);
  const referrerId = user && user.referredBy;

  if (referrerId) {
    const commissionUsd = +(paymentUsd * 0.1).toFixed(6); // 10% commission
    const commissionNaira = Math.round(payment * 0.1);
    
    const refTx = {
      id: Date.now().toString() + '_ref',
      userId: referrerId,
      type: 'referral_commission',
      source: 'ad_referral',
      title: `Referral commission from user ad watch`,
      amountUsd: commissionUsd,
      amountNaira: commissionNaira,
      date: new Date().toISOString(),
      referredUserId: userId
    };
    transactions.unshift(refTx);
    saveTransactions(transactions);
  }

  res.json({
    success: true,
    message: 'Ad watched successfully',
    payment,
    paymentUsd,
    adsToday: todaysAds.length + 1,
    remaining: Math.max(5 - (todaysAds.length + 1), 0),
    resetTime: '12:00 AM'
  });
});

module.exports = router;
