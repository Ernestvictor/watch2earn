const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  firebaseUid: {
    type: String,
    index: true
  },
  type: {
    type: String,
    enum: [
      'earning',
      'withdrawal',
      'bonus',
      'referral',
      'ad_watch',
      'offer_click',
      'signup_bonus',
      'consecutive_bonus',
      'system',
      'warning',
      'other'
    ],
    default: 'other',
    required: true
  },
  amount: {
    type: Number,
    default: 0,
    min: 0
  },
  description: {
    type: String,
    default: ''
  },
  referenceId: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'success', 'failed'],
    default: 'success'
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

module.exports = mongoose.models.History || mongoose.model('History', historySchema);
