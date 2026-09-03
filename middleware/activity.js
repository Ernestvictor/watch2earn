const { auth: firebaseAuth } = require('../config/firebaseAdmin');
const mongoNative = require('../mongodb');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_PATH = path.join(DATA_DIR, 'user_logs.json');

module.exports = async function activityLogger(req, res, next) {
  try {
    // Prefer MongoDB for activity logging. If unavailable, skip logging.

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
    // If MongoDB unavailable, skip activity file logging (deprecated)
    console.warn('Activity logging skipped: MongoDB unavailable');
  } catch (e) {
    // Don't block requests on logging errors
    console.warn('Activity logger error:', e && e.message);
  }
  return next();
};
