#!/usr/bin/env node
require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');

async function main(){
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGO_URL;
  if(!uri) return console.error('MONGODB_URI/MONGO_URI not set in environment');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS:5000, connectTimeoutMS:10000 });
  try{
    await client.connect();
    const dbName = process.env.DB_NAME || 'watch2earn';
    const db = client.db(dbName);
    const txCol = db.collection('transactions');
    const usersCol = db.collection('users');
    const rate = Number(process.env.USD_TO_NAIRA_RATE || 1500);

    const strikes = await txCol.find({ type: 'strike' }).toArray();
    if(!strikes || strikes.length === 0){
      console.log('No strike transactions found.');
      return;
    }

    let created = 0;
    for(const s of strikes){
      const refId = String(s.id || s._id);
      const exists = await txCol.findOne({ referenceId: refId, type: 'bonus' });
      if(exists) continue;

      const amountUsd = Number(s.amountUsd || 0);
      const amountNaira = Number(s.amountNaira || Math.round(amountUsd * rate) || 0);

      // credit user document (upsert)
      const filter = { $or: [ { firebaseUid: s.userId }, { uid: s.userId }, { id: s.userId }, { email: s.userId } ] };
      const update = {
        $inc: { balance: amountNaira, wallet: amountNaira, totalEarned: amountNaira },
        $setOnInsert: {
          firebaseUid: s.userId || (`backfill_${Date.now()}`),
          email: (typeof s.userId === 'string' && s.userId.includes('@')) ? s.userId : `${s.userId || 'user'}@local.user`,
          displayName: s.userId || 'User',
          status: 'active'
        }
      };
      await usersCol.updateOne(filter, update, { upsert: true });

      const bonusTx = {
        id: `${refId}_backfill_${Date.now()}`,
        userId: s.userId,
        type: 'bonus',
        source: s.source || 'daily_strike',
        title: s.title ? `${s.title} (backfilled)` : 'Daily Strike Bonus (backfilled)',
        amountUsd: amountUsd,
        amountNaira: amountNaira,
        date: new Date().toISOString(),
        referenceId: refId,
        createdAt: new Date().toISOString()
      };
      await txCol.insertOne(bonusTx);

      // mark strike as backfilled for traceability
      try { await txCol.updateOne({ _id: s._id }, { $set: { backfilledToBonus: true, backfilledAt: new Date() } }); } catch(e){}

      created++;
    }

    console.log(`Backfill complete. Created ${created} bonus transactions for ${strikes.length} strikes.`);
  }catch(err){
    console.error('Backfill error:', err && err.message || err);
    process.exitCode = 1;
  }finally{
    try{ await client.close(); }catch(e){}
  }
}

main();
