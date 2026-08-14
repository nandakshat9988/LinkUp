const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },

  // Not required: users who sign up via Google won't have a local password
  password: { type: String },
  googleId: { type: String },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema, 'LinkUp-Users');
