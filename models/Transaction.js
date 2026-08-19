const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  txId: { type: String, index: true },
  userId: { type: String, index: true },
  firebaseUid: { type: String, index: true },
  type: { type: String, required: true },
  source: { type: String },
  title: { type: String },
  amountUsd: { type: Number, default: 0 },
  amountNaira: { type: Number, default: 0 },
  date: { type: Date, default: Date.now },
  bonusId: { type: String },
  referredUserId: { type: String }
}, { timestamps: true });

module.exports = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
