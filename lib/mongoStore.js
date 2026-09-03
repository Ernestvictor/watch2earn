const mongoNative = require('../mongodb');

async function getCollection(name) {
  if (mongoNative && typeof mongoNative.getCollection === 'function') return mongoNative.getCollection(name);
  throw new Error('MongoDB native client not available. Ensure MONGODB_URI is set and mongoNative.connectDB() was called.');
}

module.exports = { getCollection };
