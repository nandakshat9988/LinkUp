const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/linkup';
  try {
    await mongoose.connect(uri);
    const maskedUri = uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
    console.log('MongoDB connected successfully:', maskedUri);
  } catch (err) {
    console.error('MongoDB connection error:', err.message);
  }
}

module.exports = connectDB;
