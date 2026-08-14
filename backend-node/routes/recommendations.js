const express = require('express');
const mongoose = require('mongoose');
const Activity = require('../models/Activity');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');
const { getDynamicRadiusKm } = require('../utils/geo');

const router = express.Router();

function fallbackRecommendations(candidates, mySkill, radiusKm) {
  return candidates.map((activity) => {
    const distanceKm = activity.distanceMeters / 1000;
    const geoScore = Math.max(0, 1 - distanceKm / radiusKm);
    const skillBonus = activity.skillLevel === mySkill ? 0.15 : 0;

    return {
      id: activity._id,
      activityType: activity.activityType,
      description: activity.description,
      contactDetails: activity.contactDetails,
      user: activity.user,
      status: activity.status,
      skillLevel: activity.skillLevel,
      distanceMeters: activity.distanceMeters,
      score: geoScore + skillBonus
    };
  }).sort((a, b) => b.score - a.score);
}

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
      {
        $match: {
          status: { $ne: 'completed' },
          user: { $ne: new mongoose.Types.ObjectId(req.user.id) }
        }
      },
      { $limit: 30 }
    ]);

    const me = await User.findById(req.user.id);
    const myHistory = await Activity.find({ participants: req.user.id });

    try {
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
            contactDetails: c.contactDetails,
            user: c.user,
            status: c.status,
            skillLevel: c.skillLevel,
            distanceMeters: c.distanceMeters
          }))
        })
      });

      if (!mlResponse.ok) throw new Error('ML service returned an error');

      const ranked = await mlResponse.json();
      return res.json({ radiusKm, candidateCount: candidates.length, ...ranked });
    } catch (mlErr) {
      const recommendations = fallbackRecommendations(candidates, me.skillLevel, radiusKm);

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
