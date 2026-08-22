const mongoose = require('mongoose');

const userCheckinSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, required: true, trim: true },
    status: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('UserCheckin', userCheckinSchema);
