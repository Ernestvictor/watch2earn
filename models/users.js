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

// Make `balance` the canonical field. Provide a `wallet` virtual for backward compatibility.
userSchema.virtual('wallet')
  .get(function() {
    return this.balance || 0;
  })
  .set(function(v) {
    this.balance = Math.max(0, Number(v || 0));
  });

userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

module.exports = mongoose.models.User || mongoose.model('User', userSchema);

