const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const verifyToken = require('../middleware/auth');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TXN_PATH = path.join(DATA_DIR, 'transactions.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');

function ensureFiles(){
  try{ fs.mkdirSync(DATA_DIR, { recursive: true }); }catch(e){}
  if(!fs.existsSync(TXN_PATH)) fs.writeFileSync(TXN_PATH, '[]');
  if(!fs.existsSync(USERS_PATH)) fs.writeFileSync(USERS_PATH, '[]');
}

function loadTransactions(){ ensureFiles(); try{ return JSON.parse(fs.readFileSync(TXN_PATH,'utf8')||'[]'); }catch(e){ return []; } }
function loadUsers(){ ensureFiles(); try{ return JSON.parse(fs.readFileSync(USERS_PATH,'utf8')||'[]'); }catch(e){ return []; } }

// GET /api/referrals - returns invited users and earnings from them for the logged-in user
router.get('/', verifyToken, (req,res) => {
  const userId = req.user.uid || req.user.id;
  const txs = loadTransactions();
  const users = loadUsers();

  // Find referral transactions that were credited to this user (type 'referral' and userId === userId)
  const referralTxs = txs.filter(t => t.type === 'referral' && (t.userId === userId));

  // Group by referredUserId
  const map = {};
  referralTxs.forEach(t => {
    const rid = t.referredUserId || t.referredUser || t.meta?.referredUserId || 'unknown';
    if(!map[rid]) map[rid] = { id: rid, totalUsd: 0, totalNaira: 0, txs: [] };
    map[rid].totalUsd += Number(t.amountUsd || 0);
    map[rid].totalNaira += Number(t.amountNaira || 0);
    map[rid].txs.push(t);
  });

  // Convert to array and enrich with user info if available
  const result = Object.values(map).map(item => {
    const found = users.find(u => u.id === item.id || u.uid === item.id || u.userId === item.id || u.id?.toString() === item.id?.toString());
    return Object.assign({}, item, {
      name: found?.name || found?.displayName || found?.email?.split('@')[0] || 'Unknown',
      email: found?.email || null,
      firstSeen: item.txs.length ? item.txs[item.txs.length-1].date : null
    });
  });

  // Also return totals
  const totals = {
    totalReferralUsd: result.reduce((s,r)=>s + (r.totalUsd||0), 0),
    totalReferralNaira: result.reduce((s,r)=>s + (r.totalNaira||0), 0),
    countInvited: result.length
  };

  res.json({ referrals: result, totals });
});

module.exports = router;
