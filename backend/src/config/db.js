const mongoose = require('mongoose');
const { initializeJsonStore } = require('./jsonModel');

async function connectDB() {
  if (process.env.DB_DRIVER === 'json') {
    initializeJsonStore();
    return;
  }
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not configured');
  }

  await mongoose.connect(mongoUri);
  console.log('MongoDB connected');
}

module.exports = connectDB;
