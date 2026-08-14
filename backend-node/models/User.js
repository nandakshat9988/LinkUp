const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },

  // Not required: users who sign up via Google won't have a local password
  password: { type: String },
  googleId: { type: String },

  // Used for content-based matching (e.g. beginner cricket players see other beginners first)
  skillLevel: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced'],
    default: 'beginner'
  },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema, 'LinkUp-Users');
