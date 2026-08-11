const express = require('express');
const Activity = require('../models/Activity');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');
const { getDynamicRadiusKm } = require('../utils/geo');

const router = express.Router();

// POST /api/recommendations — the hybrid engine.
//
// Step 1 (Node/Mongo): use the 2dsphere index to cheaply narrow millions of
//         activities down to a shortlist of nearby candidates.
// Step 2 (Python/ML):  re-rank that shortlist using collaborative filtering
//         (what similar users joined) + content/vector similarity (how close
//         the descriptions are) + skill-level matching.
//
// Geo does the FILTERING (cheap, index-backed). ML does the RANKING
// (relatively expensive, so it only ever runs on the small shortlist).
router.post('/', requireAuth, async (req, res) => {
  try {
    const { lat, lng } = req.body;
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
      { $limit: 30 }
    ]);

    const me = await User.findById(req.user.id);
    const myHistory = await Activity.find({ participants: req.user.id });

    const mlResponse = await fetch('http://127.0.0.1:5000/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        radiusKm,
        skillLevel: me.skillLevel,
        history: myHistory.map(a => ({ activityType: a.activityType, description: a.description })),
        candidates: candidates.map(c => ({
          id: c._id,
          activityType: c.activityType,
          description: c.description,
          skillLevel: c.skillLevel,
          distanceMeters: c.distanceMeters
        }))
      })
    });
    const ranked = await mlResponse.json();

    res.json({ radiusKm, candidateCount: candidates.length, ...ranked });
  } catch (err) {
    res.status(500).json({ error: 'Recommendation engine unavailable', details: err.message });
  }
});

module.exports = router;
