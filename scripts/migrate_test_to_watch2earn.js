/**
 * Migration script: Move all users from 'test' database to 'watch2earn' database
 * Usage: node scripts/migrate_test_to_watch2earn.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

async function migrateUsers() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  
  if (!mongoUri) {
    console.error('❌ MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB');

    // Get both databases
    const testDb = client.db('test');
    const watch2earnDb = client.db('watch2earn');

    const testUsersCol = testDb.collection('users');
    const watch2earnUsersCol = watch2earnDb.collection('users');

    // Fetch all users from test database
    const testUsers = await testUsersCol.find({}).toArray();
    console.log(`📊 Found ${testUsers.length} users in 'test' database`);

    if (testUsers.length === 0) {
      console.log('ℹ️ No users to migrate.');
      await client.close();
      return;
    }

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    // Migrate each user
    for (const user of testUsers) {
      try {
        // Check if user already exists in watch2earn (by email or firebaseUid)
        const query = { $or: [] };
        if (user.email) query.$or.push({ email: user.email });
        if (user.firebaseUid) query.$or.push({ firebaseUid: user.firebaseUid });
        if (user.uid) query.$or.push({ uid: user.uid });

        const existing = await watch2earnUsersCol.findOne(query);

        if (existing) {
          console.log(`⏭️  Skipped: ${user.email || user.firebaseUid} (already exists in watch2earn)`);
          skipped++;
        } else {
          // Insert user into watch2earn
          const result = await watch2earnUsersCol.insertOne(user);
          console.log(`✅ Migrated: ${user.email || user.firebaseUid} (ID: ${result.insertedId})`);
          migrated++;
        }
      } catch (e) {
        console.error(`❌ Error migrating ${user.email || user.firebaseUid}:`, e.message);
        errors++;
      }
    }

    console.log(`\n📈 Migration Summary:`);
    console.log(`   ✅ Migrated: ${migrated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log(`   📊 Total: ${migrated + skipped + errors} users processed`);

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.close();
    console.log('✅ Migration complete. Connection closed.');
  }
}

migrateUsers().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
