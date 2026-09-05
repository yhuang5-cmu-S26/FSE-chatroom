const mongoose = require('mongoose');
const { createJsonModel } = require('../config/jsonModel');

const chatGroupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  },
  { timestamps: true }
);

chatGroupSchema.index({ members: 1, updatedAt: -1 });

module.exports = process.env.DB_DRIVER === 'json'
  ? createJsonModel('groups', { members: [] })
  : mongoose.model('ChatGroup', chatGroupSchema);
