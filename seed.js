require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const Withdrawal = require('./models/Withdrawal');
const Transaction = require('./models/Transaction');

async function seed() {
  try {
    // ✅ No deprecated options
    await mongoose.connect(process.env.MONGO_URI);

    console.log('✅ Connected to MongoDB');

    // Clear old data
    await User.deleteMany({});
    await Withdrawal.deleteMany({});
    await Transaction.deleteMany({});

    // Insert test user
    const user = await User.create({
      uid: 'test-uid-123',
      email: 'testuser@example.com',
      balanceUsd: 25.50,
      adsEarn: 10.00,
      gameEarn: 5.00,
      surveyEarn: 3.50,
      refEarn: 7.00,
      invitedCount: 4,
      announcement: 'Welcome to Watch2Earn! Withdrawals open every Friday.'
    });

    // Insert test withdrawal
    await Withdrawal.create({
      userId: user.uid,
      amount: 5500,
      method: 'Bank Transfer',
      accountDetails: '1234567890 - First Bank',
      status: 'Pending'
    });

    // Insert test transactions
    await Transaction.create([
      { userId: user.uid, type: 'ads', amount: 10 },
      { userId: user.uid, type: 'game', amount: 5 },
      { userId: user.uid, type: 'survey', amount: 3.5 },
      { userId: user.uid, type: 'referral', amount: 7 }
    ]);

    console.log('🌱 Seed data inserted successfully');
    process.exit();
  } catch (err) {
    console.error('❌ Error seeding data:', err.message);
    process.exit(1);
  }
}

seed();
