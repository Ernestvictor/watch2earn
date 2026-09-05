/**
 * Diagnostic script: Find all collections and databases
 * Usage: node scripts/diagnose_mongo.js
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

async function diagnose() {
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  
  if (!mongoUri) {
    console.error('❌ MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  
  try {
    await client.connect();
    console.log('✅ Connected to MongoDB\n');

    const adminDb = client.db('admin');
    const databases = await adminDb.admin().listDatabases();

    console.log(`📊 Found ${databases.databases.length} databases:\n`);

    for (const dbInfo of databases.databases) {
      const dbName = dbInfo.name;
      if (dbName === 'admin' || dbName === 'config' || dbName === 'local') continue;

      const db = client.db(dbName);
      const collections = await db.listCollections().toArray();

      console.log(`\n📦 Database: ${dbName}`);
      console.log(`   Collections: ${collections.length}`);

      for (const col of collections) {
        const collection = db.collection(col.name);
        const count = await collection.countDocuments();
        console.log(`     - ${col.name}: ${count} documents`);

        // Show sample of bonuses if found
        if (col.name === 'bonuses' || col.name.includes('bonus')) {
          const sample = await collection.findOne();
          if (sample) {
            console.log(`       Sample: ${JSON.stringify(sample).substring(0, 100)}...`);
          }
        }
      }
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

diagnose();
