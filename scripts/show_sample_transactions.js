#!/usr/bin/env node
require('dotenv').config();
const { MongoClient } = require('mongodb');

async function main(){
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL;
  if(!uri) return console.error('MONGODB_URI/MONGO_URI not set in environment');

  const client = new MongoClient(uri, { serverSelectionTimeoutMS:5000, connectTimeoutMS:10000 });
  try{
    await client.connect();
    const dbName = process.env.DB_NAME || 'watch2earn';
    const db = client.db(dbName);
    const coll = db.collection('transactions');

    const sample = await coll.findOne({}, { sort: { createdAt: -1 } });
    if(!sample){
      console.log('No documents found in', dbName + '.transactions');
    } else {
      console.log('Sample transaction document:');
      console.log(JSON.stringify(sample, null, 2));
    }
  }catch(err){
    console.error('Error reading transactions collection:', err && err.message || err);
    const msg = (err && err.message || '').toLowerCase();
    if(msg.includes('auth') || msg.includes('authentication') || msg.includes('bad auth')){
      console.error('\nAuth failed — check your MONGODB_URI, user/password, and IP whitelist in MongoDB Atlas.');
    }
    process.exitCode = 1;
  }finally{
    try{ await client.close(); }catch(e){}
  }
}

main();
