const express = require('express');
const Activity = require('../models/Activity');
const requireAuth = require('../middleware/auth');
const { getDynamicRadiusKm } = require('../utils/geo');

const router = express.Router();

// POST /api/activities — create a new activity post (must be logged in)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { activityType, description, lat, lng, skillLevel } = req.body;

    const activity = await Activity.create({
      user: req.user.id,
      activityType,
      description,
      skillLevel: skillLevel || 'beginner',
      location: { type: 'Point', coordinates: [lng, lat] } // GeoJSON order: [lng, lat]
    });

    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/activities — plain feed, newest first (no geo filtering)
router.get('/', async (req, res) => {
  const activities = await Activity.find().sort({ createdAt: -1 }).limit(50).populate('user', 'name');
  res.json(activities);
});

// GET /api/activities/nearby?lat=&lng= — geospatial search using the
// 2dsphere index, with the search radius auto-adjusted for local density.
router.get('/nearby', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);

    const radiusKm = await getDynamicRadiusKm(lng, lat);

    // $geoNear must be the first stage of the pipeline. Because `location`
    // has a 2dsphere index, MongoDB walks that index (O(log N)) instead of
    // computing the distance to every single document (O(N)).
    const activities = await Activity.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lng, lat] },
          distanceField: 'distanceMeters',
          maxDistance: radiusKm * 1000,
          spherical: true
        }
      },
      { $limit: 50 }
    ]);

    res.json({ radiusKm, count: activities.length, activities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/activities/:id/join — join an activity. This also generates the
// interaction data ("who joined what") that the recommendation engine's
// collaborative-filtering component relies on.
router.post('/:id/join', requireAuth, async (req, res) => {
  try {
    const activity = await Activity.findByIdAndUpdate(
      req.params.id,
      { $addToSet: { participants: req.user.id } },
      { new: true }
    );
    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
