const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
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
  message: { 
    type: String, 
    required: true 
  },
  type: { 
    type: String, 
    enum: ['earning', 'withdrawal', 'system', 'warning'],
    default: 'earning'
  },
  read: { 
    type: Boolean, 
    default: false 
  }
}, { timestamps: true });

module.exports = mongoose.models.Message || mongoose.model('Message', messageSchema);

