const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  activityType: { type: String, required: true },   // e.g. "cricket", "running"
  description: { type: String, required: true },    // e.g. "Need 2 players for box cricket"
  skillLevel: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced'],
    default: 'beginner'
  },

  // GeoJSON Point — MongoDB's required shape for geospatial queries.
  // IMPORTANT: coordinates are [longitude, latitude], NOT [lat, lng].
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },

  // Users who joined this activity. This is what powers collaborative
  // filtering later: "users who joined X also tend to join Y".
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  createdAt: { type: Date, default: Date.now }
});

// The key line for this whole feature: a 2dsphere index lets MongoDB answer
// "what's near this point" in O(log N) using an underlying geohash-based
// tree structure, instead of scanning every document and computing distance
// by hand (O(N), which falls over once you have millions of active posts).
activitySchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Activity', activitySchema);
