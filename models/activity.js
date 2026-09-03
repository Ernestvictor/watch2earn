const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  firebaseUid: { type: String, default: null },
  action: { type: String, required: true },
  description: { type: String, default: '' },
  ipAddress: { type: String, default: null },
  userAgent: { type: String, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: null }
}, { timestamps: true });

// Index for efficient queries on userId and timestamp
activitySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.models.Activity || mongoose.model('Activity', activitySchema);
