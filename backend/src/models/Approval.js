const path = require('node:path');
const mongoose = require('mongoose');
const { createJsonModel } = require('../config/jsonModel');

const schema = new mongoose.Schema({
  runId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowRun', required: true, index: true },
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentMessage', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  decision: { type: String, enum: ['approved', 'handed_off'], required: true },
  reason: { type: String, maxlength: 500 },
  decidedAt: { type: Date, required: true },
}, { timestamps: true });
schema.index({ runId: 1, decidedAt: 1 });

module.exports = process.env.DB_DRIVER === 'json'
  ? createJsonModel('approvals', {}, { dataDir: process.env.WORKFLOW_DATA_DIR || path.resolve(__dirname, '../../tmp/workflow-data') })
  : mongoose.model('Approval', schema);
