const mongoose = require('mongoose');

const bonusSchema = new mongoose.Schema({
  id: { type: String, default: () => Date.now().toString() },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  amount: { type: Number, required: true },
  type: { type: String, enum: ['signup', 'daily', 'referral', 'event'], default: 'signup' },
  maxClaims: { type: Number, default: null },
  claimed: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  expiresAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.models.Bonus || mongoose.model('Bonus', bonusSchema);
