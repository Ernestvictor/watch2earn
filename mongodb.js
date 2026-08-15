const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL;
if (!uri) console.warn('⚠️ MONGODB_URI/MONGO_URI is not set — mongodb features will be disabled');

const client = new MongoClient(uri, {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 20000
});
let db = null;
let users = null;
let transactions = null;

async function connectDB() {
  if (!uri) return;

  try {
    if (!client.topology || !client.topology.isConnected()) {
      await client.connect();
    }
    db = client.db('watch2earn');
    users = db.collection('earning');
    transactions = db.collection('transactions');
    try {
      await users.createIndex({ email: 1 }, { unique: true });
    } catch (e) {}
    console.log('✅ Connected to MongoDB (native): watch2earn');
  } catch (err) {
    console.error('❌ MongoDB native connection failed:', err.message || err);
    throw err;
  }
}

function getUsersCollection() {
  if (!users) throw new Error('MongoDB not connected — call connectDB() first');
  return users;
}

function getTransactionsCollection() {
  if (!transactions) throw new Error('MongoDB not connected — call connectDB() first');
  return transactions;
}

module.exports = { connectDB, getUsersCollection, getTransactionsCollection };
