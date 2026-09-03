const mongoose = require('mongoose');

const appealSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  firebaseUid: { type: String, default: null },
  email: { type: String, default: null },
  message: { type: String, required: true, maxlength: 5000 },
  status: { type: String, enum: ['under_review','accepted','rejected'], default: 'under_review' },
  reviewedBy: { type: String, default: null },
  reviewedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.models.Appeal || mongoose.model('Appeal', appealSchema);
