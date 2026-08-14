const express = require('express');
const mongoose = require('mongoose');
const Activity = require('../models/Activity');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');
const { getDynamicRadiusKm } = require('../utils/geo');

const router = express.Router();

// Fallback scoring in Node if Python ML microservice is unreachable
function fallbackRecommendations(candidates, radiusKm) {
  return candidates.map((activity) => {
    const distanceKm = (activity.distanceMeters || 0) / 1000;
    const geoScore = Math.max(0, 1 - distanceKm / radiusKm);

    return {
      id: activity._id,
      activityType: activity.activityType,
      description: activity.description,
      venue: activity.venue,
      time: activity.time,
      membersRequired: activity.membersRequired,
      contactDetails: activity.contactDetails,
      user: activity.user,
      status: activity.status,
      participants: activity.participants || [],
      joinRequests: activity.joinRequests || [],
      distanceMeters: activity.distanceMeters,
      score: parseFloat(geoScore.toFixed(3))
    };
  }).sort((a, b) => b.score - a.score);
}

// POST /api/recommendations — the hybrid recommendation engine.
// Step 1: 2dsphere index filters millions of documents to candidate shortlist.
// Step 2: ML re-ranks shortlist using collaborative patterns + semantic text similarity.
router.post('/', requireAuth, async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const radiusKm = await getDynamicRadiusKm(lng, lat);

    const candidates = await Activity.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lng, lat] },
          distanceField: 'distanceMeters',
          maxDistance: radiusKm * 1000,
          spherical: true
        }
      },
      {
        $match: {
          status: { $ne: 'completed' },
          user: { $ne: new mongoose.Types.ObjectId(req.user.id) }
        }
      },
      { $limit: 30 }
    ]);

    // Populate user info for candidates
    await Activity.populate(candidates, [
      { path: 'user', select: 'name email' },
      { path: 'participants', select: 'name email' },
      { path: 'joinRequests', select: 'name email' }
    ]);

    const myHistory = await Activity.find({ participants: req.user.id });

    try {
      const mlServiceUrl = (process.env.ML_SERVICE_URL || 'http://127.0.0.1:5000').replace(/\/+$/, '');
      const mlResponse = await fetch(`${mlServiceUrl}/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          radiusKm,
          history: myHistory.map(a => ({ activityType: a.activityType, description: a.description })),
          candidates: candidates.map(c => ({
            id: c._id,
            activityType: c.activityType,
            description: c.description,
            venue: c.venue,
            time: c.time,
            membersRequired: c.membersRequired,
            contactDetails: c.contactDetails,
            user: c.user,
            status: c.status,
            participants: c.participants,
            joinRequests: c.joinRequests,
            distanceMeters: c.distanceMeters
          }))
        })
      });

      if (!mlResponse.ok) throw new Error('ML service returned an error');

      const ranked = await mlResponse.json();
      return res.json({ radiusKm, candidateCount: candidates.length, ...ranked });
    } catch (mlErr) {
      const recommendations = fallbackRecommendations(candidates, radiusKm);

      return res.json({
        radiusKm,
        candidateCount: candidates.length,
        fallback: true,
        recommendations
      });
    }
  } catch (err) {
    res.status(500).json({ error: 'Recommendation engine unavailable', details: err.message });
  }
});

module.exports = router;
