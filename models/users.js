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
    min: 0,
    get: function(value) { return value || 0; },
    set: function(value) { return Math.max(0, Number(value || 0)); }
  },
  coins: {
    type: Number,
    default: 0,
    min: 0
  },
  balance: { 
    type: Number,
    default: 0,
    min: 0,
    get: function(value) { return value || 0; },
    set: function(value) { return Math.max(0, Number(value || 0)); }
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
  isSuspended: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['active', 'suspended', 'banned'],
    default: 'active'
  },
  suspendReason: {
    type: String,
    default: null
  },
  banReason: {
    type: String,
    default: null
  },
  isDisabled: { 
    type: Boolean, 
    default: false 
  },
  lastLogin: {
    type: Date,
    default: null
  },
  lastActivity: {
    type: Date,
    default: null
  },
  isPassive: {
    type: Boolean,
    default: false
  },
  suspendAppeal: {
    type: String,
    default: null,
    maxlength: 2000
  },
  suspendAppealStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected', null],
    default: null
  },
  suspendAppealDate: {
    type: Date,
    default: null
  },
  suspendedDate: {
    type: Date,
    default: null
  },
  bannedDate: {
    type: Date,
    default: null
  },
  accountDetails: [{
    id: { type: String },
    type: { type: String, enum: ['bank', 'crypto'] },
    bankName: { type: String },
    accountNumber: { type: String },
    accountName: { type: String },
    cryptoType: { type: String },
    walletAddress: { type: String },
    network: { type: String },
    label: { type: String },
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

// Ensure wallet and balance are always in sync
userSchema.pre('save', function(next) {
  // Keep balance and wallet synchronized
  if (this.wallet !== this.balance) {
    this.balance = this.wallet;
  }
  next();
});

userSchema.pre('findOneAndUpdate', function(next) {
  // If wallet is being updated, also update balance
  const update = this.getUpdate();
  if (update.$inc && update.$inc.wallet) {
    update.$inc.balance = update.$inc.wallet;
  }
  if (update.$set && update.$set.wallet) {
    update.$set.balance = update.$set.wallet;
  }
  next();
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);

