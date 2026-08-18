const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  firebaseUid: { type: String, index: true },
  name: { type: String },
  amount: { type: Number, required: true },
  method: { type: String },
  accountType: { type: String },
  accountId: { type: String },
  accountName: { type: String },
  accountNumber: { type: String },
  bankName: { type: String },
  cryptoType: { type: String },
  walletAddress: { type: String },
  walletType: { type: String },
  status: { type: String, default: 'Pending' },
  charge: { type: Number, default: 0 },
  netAmount: { type: Number, default: 0 },
  risk: { type: String, default: 'Medium' },
  date: { type: String },
  approvedAt: { type: String },
  applied: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.models.Withdrawal || mongoose.model('Withdrawal', withdrawalSchema);
