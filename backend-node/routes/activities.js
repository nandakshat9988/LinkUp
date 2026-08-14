const express = require('express');
const Activity = require('../models/Activity');
const requireAuth = require('../middleware/auth');
const { getDynamicRadiusKm } = require('../utils/geo');

const router = express.Router();

function userOwnsActivity(activity, userId) {
  const ownerId = activity.user._id || activity.user;
  return ownerId.toString() === userId;
}

function canJoin(activity, userId) {
  const ownerId = activity.user._id || activity.user;
  return activity.status !== 'completed' && ownerId.toString() !== userId;
}

// Create a new activity post. The user must be logged in.
router.post('/', requireAuth, async (req, res) => {
  try {
    const { activityType, description, contactDetails, lat, lng, skillLevel } = req.body;

    if (!activityType || !description || !contactDetails || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Activity, description, contact details, and location are required' });
    }

    const activity = await Activity.create({
      user: req.user.id,
      activityType,
      description,
      contactDetails,
      skillLevel: skillLevel || 'beginner',
      location: { type: 'Point', coordinates: [lng, lat] }
    });

    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Public feed. Newest posts come first.
router.get('/', async (req, res) => {
  const activities = await Activity.find()
    .sort({ createdAt: -1 })
    .limit(50)
    .populate('user', 'name');

  res.json(activities);
});

// Posts created by the logged-in user.
router.get('/mine', requireAuth, async (req, res) => {
  const activities = await Activity.find({ user: req.user.id })
    .sort({ createdAt: -1 })
    .populate('participants', 'name email');

  res.json(activities);
});

// Nearby search uses the MongoDB 2dsphere index.
router.get('/nearby', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);

    const radiusKm = await getDynamicRadiusKm(lng, lat);

    const activities = await Activity.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lng, lat] },
          distanceField: 'distanceMeters',
          maxDistance: radiusKm * 1000,
          spherical: true
        }
      },
      { $match: { status: { $ne: 'completed' } } },
      { $limit: 50 }
    ]);

    res.json({ radiusKm, count: activities.length, activities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit your own post.
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    if (!userOwnsActivity(activity, req.user.id)) {
      return res.status(403).json({ error: 'You can edit only your own posts' });
    }

    activity.activityType = req.body.activityType || activity.activityType;
    activity.description = req.body.description || activity.description;
    activity.contactDetails = req.body.contactDetails || activity.contactDetails;
    activity.skillLevel = req.body.skillLevel || activity.skillLevel;

    await activity.save();
    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark your own post as completed.
router.patch('/:id/complete', requireAuth, async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    if (!userOwnsActivity(activity, req.user.id)) {
      return res.status(403).json({ error: 'You can complete only your own posts' });
    }

    activity.status = 'completed';
    activity.completedAt = new Date();

    await activity.save();
    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete your own post.
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    if (!userOwnsActivity(activity, req.user.id)) {
      return res.status(403).json({ error: 'You can delete only your own posts' });
    }

    await Activity.deleteOne({ _id: activity._id });
    res.json({ message: 'Activity deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Join a post and return the full details needed by the joining user.
router.post('/:id/join', requireAuth, async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    if (!canJoin(activity, req.user.id)) {
      return res.status(400).json({ error: 'This activity cannot be joined' });
    }

    activity.participants.addToSet(req.user.id);
    await activity.save();

    const details = await Activity.findById(activity._id)
      .populate('user', 'name email')
      .populate('participants', 'name email');

    res.json(details);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
