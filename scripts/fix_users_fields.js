const mongoNative = require('../mongodb');
const fs = require('fs');
const path = require('path');

async function run() {
  try {
    await mongoNative.connectDB();
  } catch (e) {
    console.error('Failed to connect to MongoDB:', e && e.message);
    process.exit(1);
  }

  const usersCol = mongoNative.getCollection('users');
  // populate missing uid and promoted fields in Mongo
  try {
    const cursor = usersCol.find({ $or: [ { uid: { $exists: false } }, { promoted: { $exists: false } } ] });
    let count = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const updates = {};
      if (!doc.uid) updates.uid = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
      if (typeof doc.promoted === 'undefined') updates.promoted = false;
      if (Object.keys(updates).length) {
        await usersCol.updateOne({ _id: doc._id }, { $set: updates });
        count++;
      }
    }
    console.log(`Updated ${count} Mongo user documents`);
  } catch (e) { console.error('Mongo user field update failed:', e && e.message); }

  // also update file-based users.json fallback
  try {
    const DATA_DIR = path.join(__dirname, '..', 'data');
    const usersPath = path.join(DATA_DIR, 'users.json');
    if (fs.existsSync(usersPath)) {
      const raw = fs.readFileSync(usersPath, 'utf8') || '[]';
      const users = JSON.parse(raw);
      let updated = 0;
      for (const u of users) {
        if (!u.uid) { u.uid = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); updated++; }
        if (typeof u.promoted === 'undefined') { u.promoted = false; }
      }
      if (updated) fs.writeFileSync(usersPath, JSON.stringify(users, null, 2));
      console.log(`Updated ${updated} file-based users`);
    }
  } catch (e) { console.error('File users update failed:', e && e.message); }

  console.log('Done.');
  process.exit(0);
}

if (require.main === module) run();

module.exports = { run };
