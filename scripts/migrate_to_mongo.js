const fs = require('fs');
const path = require('path');
const mongoNative = require('../mongodb');

async function migrate() {
  try {
    await mongoNative.connectDB();
  } catch (e) {
    console.error('Migration aborted — failed to connect to MongoDB:', e && e.message);
    process.exit(1);
  }

  const DATA_DIR = path.join(__dirname, '..', 'data');

  // Helper to safely read json
  function readJson(file) {
    try {
      const p = path.join(DATA_DIR, file);
      if (!fs.existsSync(p)) return [];
      const raw = fs.readFileSync(p, 'utf8') || '[]';
      return JSON.parse(raw);
    } catch (e) {
      console.error('Failed to read', file, e && e.message);
      return [];
    }
  }

  // Transactions -> transactions collection
  const txs = readJson('transactions.json');
  if (txs.length) {
    try {
      const col = mongoNative.getTransactionsCollection();
      for (const t of txs) {
        try {
          // normalize date
          if (t.date) t.date = new Date(t.date);
          await col.updateOne({ id: t.id }, { $setOnInsert: t }, { upsert: true });
        } catch (e) { /* continue */ }
      }
      console.log(`Migrated ${txs.length} transactions`);
    } catch (e) { console.error('Failed to migrate transactions:', e && e.message); }
  }

  // Users -> users collection
  const users = readJson('users.json');
  if (users.length) {
    try {
      const col = mongoNative.getCollection('users');
      for (const u of users) {
        try { await col.updateOne({ id: u.id }, { $setOnInsert: u }, { upsert: true }); } catch (e) {}
      }
      console.log(`Migrated ${users.length} users`);
    } catch (e) { console.error('Failed to migrate users:', e && e.message); }
  }

  // Bonuses -> bonuses collection
  const bonuses = readJson('bonuses.json');
  if (bonuses.length) {
    try {
      const col = mongoNative.getCollection('bonuses');
      for (const b of bonuses) {
        try { await col.updateOne({ id: b.id }, { $setOnInsert: b }, { upsert: true }); } catch (e) {}
      }
      console.log(`Migrated ${bonuses.length} bonuses`);
    } catch (e) { console.error('Failed to migrate bonuses:', e && e.message); }
  }

  // Messages -> messages collection
  const messages = readJson('messages.json') || readJson('messeges.json') || readJson('messages.json');
  if (messages.length) {
    try {
      const col = mongoNative.getCollection('messages');
      for (const m of messages) {
        try { if (m.date) m.date = new Date(m.date); await col.updateOne({ id: m.id }, { $setOnInsert: m }, { upsert: true }); } catch (e) {}
      }
      console.log(`Migrated ${messages.length} messages`);
    } catch (e) { console.error('Failed to migrate messages:', e && e.message); }
  }

  // Settings -> settings (single doc)
  try {
    const settingsPath = path.join(DATA_DIR, 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf8') || '{}';
      const json = JSON.parse(raw);
      const col = mongoNative.getCollection('settings');
      await col.updateOne({ _id: 'settings' }, { $set: json }, { upsert: true });
      console.log('Migrated settings');
    }
  } catch (e) { console.error('Failed to migrate settings:', e && e.message); }

  console.log('Migration complete.');
}

if (require.main === module) {
  migrate().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}

module.exports = { migrate }; 
