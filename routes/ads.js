const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const auth = require('../middleware/auth');

const ADS_PATH = path.join(__dirname, '..', 'ads.json');

function ensureAdsFile(){
  try{ fs.mkdirSync(path.dirname(ADS_PATH), { recursive: true }); }catch(e){}
  if(!fs.existsSync(ADS_PATH)) fs.writeFileSync(ADS_PATH, '[]');
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

module.exports = router;
