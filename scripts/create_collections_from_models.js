#!/usr/bin/env node
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

async function main(){
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL;
  if(!uri) return console.error('MONGODB_URI/MONGO_URI not set in environment');

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 10000, socketTimeoutMS: 20000 });
  try{
    await client.connect();
    const dbName = process.env.DB_NAME || 'watch2earn';
    const db = client.db(dbName);

    const modelsDir = path.join(__dirname, '..', 'models');
    if(!fs.existsSync(modelsDir)) return console.error('models directory not found:', modelsDir);

    const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.js'));
    if(files.length === 0) return console.log('No model files found to process');

    for(const file of files){
      const name = path.basename(file, '.js');
      const collName = name.toLowerCase();
      const content = fs.readFileSync(path.join(modelsDir, file), 'utf8');

      const exists = await db.listCollections({ name: collName }).hasNext();
      if(!exists){
        await db.createCollection(collName);
        console.log('Created collection', collName);
      } else {
        console.log('Collection exists', collName);
      }

      // Basic index heuristics
      try{
        if(/firebaseUid/.test(content)){
          await db.collection(collName).createIndex({ firebaseUid: 1 }, { sparse: true }).catch(()=>{});
          console.log('Ensured index on firebaseUid for', collName);
        }
        if(/email/.test(content)){
          await db.collection(collName).createIndex({ email: 1 }, { sparse: true }).catch(()=>{});
          console.log('Ensured index on email for', collName);
        }
        if(/userId/.test(content)){
          await db.collection(collName).createIndex({ userId: 1 }).catch(()=>{});
          console.log('Ensured index on userId for', collName);
        }
        if(/createdAt/.test(content)){
          await db.collection(collName).createIndex({ createdAt: -1 }).catch(()=>{});
          console.log('Ensured index on createdAt for', collName);
        }
      }catch(e){ console.warn('Index creation warning for', collName, e.message || e); }
    }

    console.log('Done — models -> collections created/verified in', dbName);
  }catch(err){
    console.error('Error:', err && err.message || err);
    // Friendly troubleshooting hints for common failures
    const msg = (err && err.message || '').toLowerCase();
    if (msg.includes('auth') || msg.includes('authentication') || msg.includes('bad auth') || msg.includes('unauthorized')){
      console.error('\n⚠️ MongoDB authentication failed. Quick checks:');
      console.error('- Verify `MONGODB_URI` in your .env uses the correct username and password.');
      console.error('- URL-encode any special characters in the password (e.g. @, /, :).');
      console.error('- In MongoDB Atlas → Database Access ensure the user exists and the password matches.');
      console.error('- In MongoDB Atlas → Network Access ensure your IP (or 0.0.0.0/0 for testing) is whitelisted.');
      console.error('- Ensure the connection string targets the correct cluster/project.');
      console.error('- Confirm `DB_NAME` (default `watch2earn`) matches the intended database.');
      console.error('\nTip: Use the Atlas "Connect" button → "Connect your application" to copy a working URI.');
    }
    if (msg.includes('parse') || msg.includes('invalid') || msg.includes('unsupported')){
      console.error('\n⚠️ Connection string parsing issue.');
      console.error('- Remove unsupported MongoClient options (e.g. `useNewUrlParser`, `useUnifiedTopology`) from scripts.');
      console.error('- Use the exact connection string copied from Atlas and do not append unsupported params.');
    }
    process.exitCode = 1;
  }finally{
    try{ await client.close(); }catch(e){}
  }
}

main();
