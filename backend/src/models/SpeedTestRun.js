const mongoose = require('mongoose');
const { createJsonModel } = require('../config/jsonModel');

const speedTestRunSchema = new mongoose.Schema(
  {
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['queued', 'running', 'completed', 'failed'], default: 'queued', index: true },
    config: { concurrency: { type: Number, default: 10 }, durationSeconds: { type: Number, default: 10 } },
    result: { type: mongoose.Schema.Types.Mixed, default: null },
    error: { type: String, default: '' },
  },
  { timestamps: true }
);
speedTestRunSchema.index({ createdAt: -1 });
module.exports = process.env.DB_DRIVER === 'json'
  ? createJsonModel('speed-tests', { status: 'queued', result: null, error: '' })
  : mongoose.model('SpeedTestRun', speedTestRunSchema);
