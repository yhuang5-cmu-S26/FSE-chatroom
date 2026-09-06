const mongoose = require('mongoose');
const { createJsonModel } = require('../config/jsonModel');

const postSchema = new mongoose.Schema(
  {
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    authorName: { type: String, required: true, trim: true, maxlength: 80 },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    agentIdempotencyKey: { type: String, trim: true, sparse: true, unique: true, maxlength: 160 },
  },
  { timestamps: true }
);

postSchema.index({ createdAt: -1 });
module.exports = process.env.DB_DRIVER === 'json'
  ? createJsonModel('posts')
  : mongoose.model('Post', postSchema);
