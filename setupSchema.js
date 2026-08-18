require('dotenv').config();
const { MongoClient } = require('mongodb');

async function setup() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL;
  if (!uri) {
    throw new Error('Missing MongoDB URI. Set MONGODB_URI or MONGO_URI in your .env file.');
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 20000
  });

  try {
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'watch2earn');

    const collections = ['users', 'earnings', 'history', 'messages'];
    for (const name of collections) {
      const exists = await db.listCollections({ name }).hasNext();
      if (!exists) {
        await db.createCollection(name);
        console.log(`✅ Created collection: ${name}`);
      } else {
        console.log(`ℹ️ Collection already exists: ${name}`);
      }
    }

    await db.collection('users').createIndex({ firebaseUid: 1 }, { unique: true, sparse: true }).catch(() => {});
    await db.collection('users').createIndex({ email: 1 }, { sparse: true }).catch(() => {});
    await db.collection('earnings').createIndex({ userId: 1, createdAt: -1 }).catch(() => {});
    await db.collection('history').createIndex({ userId: 1, createdAt: -1 }).catch(() => {});
    await db.collection('messages').createIndex({ userId: 1, read: 1 }).catch(() => {});

    console.log('✅ Mongo schema/indexes are ready');
  } finally {
    await client.close();
  }
}

setup().catch((err) => {
  console.error('❌ Error setting up schema:', err.message || err);
  process.exit(1);
});
