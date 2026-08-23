const mongoose = require('mongoose');

const helpRequestSchema = new mongoose.Schema(
  {
    description: { type: String, required: true, trim: true },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
    },
    location: {
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
      detail: { type: String, trim: true },
    },
    status: {
      type: String,
      enum: ['open', 'assigned', 'in_progress', 'resolved'],
      default: 'open',
    },
  },
  { timestamps: true }
);

helpRequestSchema.index({ status: 1, priority: 1, createdAt: -1 });
helpRequestSchema.index({ 'location.latitude': 1, 'location.longitude': 1 });

module.exports = mongoose.model('HelpRequest', helpRequestSchema);
