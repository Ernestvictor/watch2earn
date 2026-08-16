const mongoose = require('mongoose');

const earningSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true,
    index: true // fast search by user
  },
  firebaseUid: { 
    type: String, 
    index: true 
  },
  amount: { 
    type: Number, 
    required: true,
    min: 0 // validation
  },
  type: { 
    type: String, 
    enum: ['ad_watch', 'referral', 'bonus', 'withdrawal'],
    required: true
  },
  description: { 
    type: String 
  }
}, { timestamps: true }); // adds createdAt

module.exports = mongoose.models.Earning || mongoose.model('Earning', earningSchema);