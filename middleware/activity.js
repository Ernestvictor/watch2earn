const { auth: firebaseAuth } = require('../config/firebaseAdmin');
const mongoNative = require('../mongodb');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_PATH = path.join(DATA_DIR, 'user_logs.json');

function ensureLogFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, '[]');
}

module.exports = async function activityLogger(req, res, next) {
  try {
    ensureLogFile();

    const authHeader = req.headers && req.headers.authorization;
    let uid = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = await firebaseAuth.verifyIdToken(token);
        uid = decoded && (decoded.uid || decoded.user_id || decoded.sub);
      } catch (e) {
        // ignore invalid token
      }
    }

    const entry = {
      id: 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2,8),
      userId: uid || null,
      route: req.originalUrl || req.url,
      method: req.method,
      ip: req.ip || req.connection && req.connection.remoteAddress || null,
      userAgent: req.headers['user-agent'] || null,
      timestamp: new Date().toISOString()
    };

    // Try to store in Mongo if available
    try {
      if (mongoNative && typeof mongoNative.getCollection === 'function') {
        const col = mongoNative.getCollection('user_activity');
        await col.insertOne(entry).catch(()=>{});
        return next();
      }
    } catch (e) { /* fall back to file */ }

    // Fallback to file-based logging
    try {
      const arr = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8') || '[]');
      arr.unshift(entry);
      fs.writeFileSync(LOG_PATH, JSON.stringify(arr.slice(0, 2000), null, 2));
    } catch (e) { /* ignore */ }
  } catch (e) {
    // Don't block requests on logging errors
    console.warn('Activity logger error:', e && e.message);
  }
  return next();
};
