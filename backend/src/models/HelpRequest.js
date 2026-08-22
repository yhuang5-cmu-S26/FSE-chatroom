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

module.exports = mongoose.model('HelpRequest', helpRequestSchema);
