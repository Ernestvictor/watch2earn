const mongoose = require('mongoose');

const promotionSchema = new mongoose.Schema({
  id: { type: String, default: () => Date.now().toString() },
  userId: { type: String, required: true },
  firebaseUid: { type: String, default: null },
  type: { type: String, default: 'promotion' },
  amount: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  description: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.models.Promotion || mongoose.model('Promotion', promotionSchema);
