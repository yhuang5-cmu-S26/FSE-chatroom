const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    room: { type: String, required: true, index: true },
    sender: { type: String, required: true, trim: true },
    recipientId: { type: String, trim: true, default: null },
    clientMessageId: { type: String, trim: true, default: null },
    message: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

chatMessageSchema.index({ room: 1, createdAt: -1 });
chatMessageSchema.index({ sender: 1, createdAt: -1 });
chatMessageSchema.index({ recipientId: 1, createdAt: -1 });
chatMessageSchema.index({ clientMessageId: 1, createdAt: -1 });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
