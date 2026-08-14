require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const TXN_PATH = path.join(DATA_DIR, 'transactions.json');
const WITHDRAW_PATH = path.join(DATA_DIR, 'withdrawals.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

async function seed() {
  try {
    ensureDir();

    const user = {
      id: 'test-uid-123',
      uid: 'test-uid-123',
      email: 'testuser@example.com',
      displayName: 'Test User',
      balance: 0
    };

    const transactions = [
      { id: 'txn_' + Date.now(), userId: user.uid, type: 'ads', amountUsd: 10, amountNaira: 10 * 1500, date: new Date().toISOString() },
      { id: 'txn_' + (Date.now()+1), userId: user.uid, type: 'game', amountUsd: 5, amountNaira: 5 * 1500, date: new Date().toISOString() },
      { id: 'txn_' + (Date.now()+2), userId: user.uid, type: 'survey', amountUsd: 3.5, amountNaira: Math.round(3.5 * 1500), date: new Date().toISOString() },
      { id: 'txn_' + (Date.now()+3), userId: user.uid, type: 'referral', amountUsd: 7, amountNaira: 7 * 1500, date: new Date().toISOString() }
    ];

    const withdrawals = [
      { id: 'wd_' + Date.now(), userId: user.uid, amount: 5500, method: 'Bank Transfer', accountDetails: '1234567890 - First Bank', status: 'Pending', date: new Date().toISOString() }
    ];

    writeJson(USERS_PATH, [user]);
    writeJson(TXN_PATH, transactions);
    writeJson(WITHDRAW_PATH, withdrawals);

    console.log('🌱 Seed data written to data/ (users, transactions, withdrawals)');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error writing seed data:', err);
    process.exit(1);
  }
}

seed();
