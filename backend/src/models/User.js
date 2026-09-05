const mongoose = require('mongoose');
const { createJsonModel } = require('../config/jsonModel');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['user', 'dispatcher', 'admin'], default: 'user', index: true },
    active: { type: Boolean, default: true, index: true },
    sessionId: { type: String, index: true },
  },
  { timestamps: true }
);

userSchema.index({ role: 1, active: 1 });

module.exports = process.env.DB_DRIVER === 'json'
  ? createJsonModel('users', { role: 'user', active: true })
  : mongoose.model('User', userSchema);
