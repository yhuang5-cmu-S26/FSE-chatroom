const mongoose = require('mongoose');
const { createJsonModel } = require('../config/jsonModel');

// Canonical pair rows scale better than embedding every contact in User documents.
// Every newly registered user gets an accepted row with each existing user.
const relationshipSchema = new mongoose.Schema(
  {
    userLow: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userHigh: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['accepted'], default: 'accepted' },
  },
  { timestamps: true }
);

relationshipSchema.index({ userLow: 1, userHigh: 1 }, { unique: true });
relationshipSchema.index({ userLow: 1, status: 1 });
relationshipSchema.index({ userHigh: 1, status: 1 });

module.exports = process.env.DB_DRIVER === 'json'
  ? createJsonModel('relationships', { status: 'accepted' })
  : mongoose.model('Relationship', relationshipSchema);
