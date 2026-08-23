const mongoose = require('mongoose');

const validStatuses = ['pending', 'in_progress', 'blocked', 'resolved'];

const userCheckinSchema = new mongoose.Schema(
  {
    task: { type: String, required: true, trim: true },
    note: { type: String, trim: true, default: '' },
    role: { type: String, required: true, trim: true },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    status: {
      type: String,
      enum: validStatuses,
      default: 'pending',
    },
    reporterId: { type: String, required: true, trim: true },
    reporterName: { type: String, required: true, trim: true },
    assignedTo: { type: String, trim: true, default: '' },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userCheckinSchema.index({ status: 1, priority: 1, createdAt: -1 });
userCheckinSchema.index({ role: 1, status: 1, createdAt: -1 });
userCheckinSchema.index({ reporterId: 1, createdAt: -1 });
userCheckinSchema.index({ assignedTo: 1, createdAt: -1 });

module.exports = mongoose.model('UserCheckin', userCheckinSchema);
