const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referralId: {
    type: String,
    unique: true,
    index: true,
    sparse: true,
    default: function () {
      return `ref_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
  },
  referredByUid: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  referredByEmail: {
    type: String,
    default: '',
    trim: true,
    lowercase: true
  },
  referredUid: {
    type: String,
    required: true,
    index: true,
    trim: true
  },
  referredEmail: {
    type: String,
    default: '',
    trim: true,
    lowercase: true
  },
  commission: {
    type: Number,
    default: 0,
    min: 0
  },
  source: {
    type: String,
    default: 'signup',
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'active', 'paid', 'cancelled'],
    default: 'active'
  }
}, { timestamps: true });

referralSchema.index({ referredByUid: 1, referredUid: 1 }, { unique: true });

module.exports = mongoose.models.Referral || mongoose.model('Referral', referralSchema);
