const mongoose = require('mongoose');
const dns = require('dns');

// Set reliable DNS servers for MongoDB SRV record resolution
try {
  dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch (e) {
  // Ignore in restricted sandboxes
}

let cached = global.mongoose;
if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/linkup';

  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      serverSelectionTimeoutMS: 10000,
    };
    cached.promise = mongoose.connect(uri, opts).then((mongooseInstance) => {
      const maskedUri = uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
      console.log('MongoDB connected successfully:', maskedUri);
      return mongooseInstance;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    console.error('MongoDB connection error:', err.message);
    throw err;
  }

  return cached.conn;
}

module.exports = connectDB;
