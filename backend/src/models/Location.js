const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, trim: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    note: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Location', locationSchema);
