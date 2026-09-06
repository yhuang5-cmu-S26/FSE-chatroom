const path = require('node:path');
const mongoose = require('mongoose');
const { createJsonModel } = require('../config/jsonModel');

const agentSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, trim: true, maxlength: 160, default: '新建协作会话' },
    status: { type: String, enum: ['active', 'archived'], default: 'active', index: true },
    lastMessageAt: { type: Date, default: Date.now },
    contextMemory: {
      summary: { type: String, default: '', maxlength: 4000 },
      sourceMessageCount: { type: Number, default: 0 },
      sourceChars: { type: Number, default: 0 },
      updatedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);
agentSessionSchema.index({ userId: 1, status: 1, lastMessageAt: -1 });

module.exports = process.env.DB_DRIVER === 'json'
  ? createJsonModel('sessions', { title: '新建协作会话', status: 'active' }, { dataDir: process.env.AGENT_SESSION_DATA_DIR || process.env.LLM_SESSION_DATA_DIR || path.resolve(__dirname, '../../tmp/llm-session') })
  : mongoose.model('AgentSession', agentSessionSchema);
