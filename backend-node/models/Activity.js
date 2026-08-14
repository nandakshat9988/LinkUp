const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  activityType: { type: String, required: true },   // e.g. "Cricket", "Football", "Running"
  description: { type: String, required: true },    // e.g. "Need 2 players for friendly weekend match"
  venue: { type: String, required: true },          // e.g. "Decathlon Turf, Central Park"
  time: { type: String, required: true },           // e.g. "Saturday at 6:00 PM"
  membersRequired: { type: Number, default: 1, min: 1 }, // Total number of players/members needed
  contactDetails: { type: String, default: '' },    // Shared with confirmed participants

  status: {
    type: String,
    enum: ['open', 'completed'],
    default: 'open'
  },

  // GeoJSON Point — MongoDB's required shape for geospatial queries.
  // IMPORTANT: coordinates are [longitude, latitude], NOT [lat, lng].
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }
  },

  // Users waiting for host confirmation to join
  joinRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  // Users who have been confirmed by the post creator
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

  completedAt: { type: Date },
  createdAt: { type: Date, default: Date.now }
});

// The key line for this whole feature: a 2dsphere index lets MongoDB answer
// "what's near this point" in O(log N) using an underlying geohash-based
// tree structure, instead of scanning every document and computing distance
// by hand (O(N), which falls over once you have millions of active posts).
activitySchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Activity', activitySchema);
