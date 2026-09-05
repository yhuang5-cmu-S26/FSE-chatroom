const mongoose = require('mongoose');
const { createJsonModel } = require('../config/jsonModel');

const validStatuses = ['pending', 'in_progress', 'blocked', 'resolved'];

const userCheckinSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, default: '', maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    assigneeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    checkedInUserIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    dueAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userCheckinSchema.index({ assigneeIds: 1, createdAt: -1 });

module.exports = process.env.DB_DRIVER === 'json'
  ? createJsonModel('checkins', { description: '', assigneeIds: [], checkedInUserIds: [], dueAt: null })
  : mongoose.model('UserCheckin', userCheckinSchema);
