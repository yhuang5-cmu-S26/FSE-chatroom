const mongoose = require('mongoose');
const { createJsonModel } = require('../config/jsonModel');

const chatMessageSchema = new mongoose.Schema(
  {
    room: { type: String, required: true, index: true },
    sender: { type: String, required: true, trim: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    mode: { type: String, enum: ['public', 'private', 'group'], required: true, index: true },
    clientMessageId: { type: String, trim: true, default: null },
    message: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

chatMessageSchema.index({ room: 1, createdAt: -1 });
chatMessageSchema.index({ mode: 1, room: 1, createdAt: -1 });
chatMessageSchema.index({ recipientId: 1, createdAt: -1 });
chatMessageSchema.index({ clientMessageId: 1, createdAt: -1 });

module.exports = process.env.DB_DRIVER === 'json'
  ? createJsonModel('messages', { recipientId: null, clientMessageId: null })
  : mongoose.model('ChatMessage', chatMessageSchema);
