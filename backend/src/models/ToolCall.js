const path = require('node:path');
const mongoose = require('mongoose');
const { createJsonModel } = require('../config/jsonModel');

const schema = new mongoose.Schema({
  runId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowRun', required: true, index: true },
  stepId: { type: mongoose.Schema.Types.ObjectId, ref: 'WorkflowStep', required: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actionType: { type: String, required: true },
  input: mongoose.Schema.Types.Mixed,
  state: { type: String, enum: ['running', 'succeeded', 'failed'], required: true, index: true },
  output: mongoose.Schema.Types.Mixed,
  error: { type: String, maxlength: 1000 },
  errorType: { type: String, maxlength: 80 },
  startedAt: { type: Date, required: true },
  completedAt: Date,
  durationMs: Number,
}, { timestamps: true });
schema.index({ runId: 1, createdAt: 1 });

module.exports = process.env.DB_DRIVER === 'json'
  ? createJsonModel('tool-calls', {}, { dataDir: process.env.WORKFLOW_DATA_DIR || path.resolve(__dirname, '../../tmp/workflow-data') })
  : mongoose.model('ToolCall', schema);
