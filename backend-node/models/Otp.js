const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, index: true },
  otp: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 600 } // MongoDB TTL index: expires in 10 minutes (600s)
});

module.exports = mongoose.model('Otp', otpSchema);
