const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firebaseUid: { 
    type: String, 
    required: true, 
    unique: true, 
    index: true,
    sparse: true
  },
  email: { 
    type: String,
    required: true,
    index: true,
    sparse: true
  },
  username: { 
    type: String 
  },
  displayName: {
    type: String,
    default: ''
  },
  wallet: { 
    type: Number, 
    default: 0,
    min: 0
  },
  coins: {
    type: Number,
    default: 0,
    min: 0
  },
  balance: { 
    type: Number,
    default: 0,
    min: 0
  },
  totalEarned: {
    type: Number,
    default: 0,
    min: 0
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  lastAdShowTime: {
    type: Date,
    default: null
  },
  isBanned: { 
    type: Boolean, 
    default: false 
  },
  isDisabled: { 
    type: Boolean, 
    default: false 
  }
}, { timestamps: true });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);

