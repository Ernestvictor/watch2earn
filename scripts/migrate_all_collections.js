/**
 * Migration script: Move ALL collections from 'test' database to 'watch2earn' database
 * Usage: node scripts/migrate_all_collections.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

async function migrateAllCollections() {
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

    // List all collections in test database
    const testCollections = await testDb.listCollections().toArray();
    console.log(`\n📊 Found ${testCollections.length} collections in 'test' database:`);
    testCollections.forEach(col => console.log(`   - ${col.name}`));

    if (testCollections.length === 0) {
      console.log('ℹ️ No collections to migrate.');
      await client.close();
      return;
    }

    let totalMigrated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    // Migrate each collection
    for (const collInfo of testCollections) {
      const collName = collInfo.name;
      console.log(`\n📦 Migrating collection: ${collName}`);

      try {
        const testCol = testDb.collection(collName);
        const watch2earnCol = watch2earnDb.collection(collName);

        // Count documents in both collections
        const testCount = await testCol.countDocuments();
        const existingCount = await watch2earnCol.countDocuments();

        console.log(`   📈 test.${collName}: ${testCount} documents`);
        console.log(`   📈 watch2earn.${collName}: ${existingCount} documents`);

        if (testCount === 0) {
          console.log(`   ⏭️  Skipped (empty collection)`);
          totalSkipped += testCount;
          continue;
        }

        // Fetch all documents from test
        const docs = await testCol.find({}).toArray();

        // Insert into watch2earn with upsert logic
        let migrated = 0;
        let skipped = 0;
        let errors = 0;

        for (const doc of docs) {
          try {
            // Use _id as unique identifier if available
            if (doc._id) {
              const result = await watch2earnCol.updateOne(
                { _id: doc._id },
                { $set: doc },
                { upsert: true }
              );
              if (result.upsertedId) {
                migrated++;
              } else {
                skipped++;
              }
            } else {
              // No _id, just insert
              await watch2earnCol.insertOne(doc);
              migrated++;
            }
          } catch (e) {
            console.error(`      ❌ Error inserting document:`, e.message);
            errors++;
          }
        }

        console.log(`   ✅ Migrated: ${migrated}`);
        console.log(`   ⏭️  Skipped: ${skipped}`);
        console.log(`   ❌ Errors: ${errors}`);

        totalMigrated += migrated;
        totalSkipped += skipped;
        totalErrors += errors;

      } catch (e) {
        console.error(`❌ Error migrating collection ${collName}:`, e.message);
        totalErrors += 1;
      }
    }

    console.log(`\n\n📊 ═══════════════════════════════════════════════════`);
    console.log(`📈 MIGRATION SUMMARY`);
    console.log(`📊 ═══════════════════════════════════════════════════`);
    console.log(`   ✅ Total Migrated: ${totalMigrated} documents`);
    console.log(`   ⏭️  Total Skipped: ${totalSkipped} documents`);
    console.log(`   ❌ Total Errors: ${totalErrors}`);
    console.log(`📊 ═══════════════════════════════════════════════════\n`);

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.close();
    console.log('✅ Migration complete. Connection closed.');
  }
}

migrateAllCollections().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
