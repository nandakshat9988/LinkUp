const express = require('express');
const Activity = require('../models/Activity');
const requireAuth = require('../middleware/auth');
const { getDynamicRadiusKm } = require('../utils/geo');

const router = express.Router();

function userOwnsActivity(activity, userId) {
  const ownerId = activity.user._id || activity.user;
  return ownerId.toString() === userId;
}

// 1. Create a new activity post
router.post('/', requireAuth, async (req, res) => {
  try {
    const { activityType, description, venue, time, membersRequired, contactDetails, lat, lng } = req.body;

    if (!activityType || !description || !venue || !time || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Activity type, description, venue, time, and location are required' });
    }

    const activity = await Activity.create({
      user: req.user.id,
      activityType: activityType.trim(),
      description: description.trim(),
      venue: venue.trim(),
      time: time.trim(),
      membersRequired: Math.max(1, parseInt(membersRequired, 10) || 1),
      contactDetails: (contactDetails || '').trim(),
      location: { type: 'Point', coordinates: [lng, lat] },
      joinRequests: [],
      participants: []
    });

    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Public feed (newest open posts first)
router.get('/', async (req, res) => {
  try {
    const activities = await Activity.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('user', 'name email')
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email');

    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Posts created by the logged-in user
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const activities = await Activity.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email');

    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Nearby search using MongoDB 2dsphere index
router.get('/nearby', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Valid latitude and longitude are required' });
    }

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

    // Populate user and participant details
    await Activity.populate(activities, [
      { path: 'user', select: 'name email' },
      { path: 'participants', select: 'name email' },
      { path: 'joinRequests', select: 'name email' }
    ]);

    res.json({ radiusKm, count: activities.length, activities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Get a single activity by ID (for the detailed join / confirmation page)
router.get('/:id', async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id)
      .populate('user', 'name email')
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email');

    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. User submits a request to join an activity post
router.post('/:id/request-join', requireAuth, async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    if (activity.status === 'completed') {
      return res.status(400).json({ error: 'This activity is already completed or full' });
    }

    if (userOwnsActivity(activity, req.user.id)) {
      return res.status(400).json({ error: 'You are the host of this post' });
    }

    // Check if already confirmed participant
    const isParticipant = activity.participants.some(p => p.toString() === req.user.id);
    if (isParticipant) {
      return res.status(400).json({ error: 'You have already been confirmed for this activity' });
    }

    // Check if already requested
    const isRequested = activity.joinRequests.some(r => r.toString() === req.user.id);
    if (isRequested) {
      return res.status(400).json({ error: 'You have already sent a join request for this activity' });
    }

    activity.joinRequests.addToSet(req.user.id);
    await activity.save();

    const updated = await Activity.findById(activity._id)
      .populate('user', 'name email')
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email');

    res.json({ message: 'Join request sent to host successfully', activity: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Host confirms a participant from pending join requests
router.post('/:id/confirm-participant', requireAuth, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    if (!userOwnsActivity(activity, req.user.id)) {
      return res.status(403).json({ error: 'Only the post creator can confirm participants' });
    }

    // Remove from join requests and add to confirmed participants
    activity.joinRequests = activity.joinRequests.filter(r => r.toString() !== userId);
    activity.participants.addToSet(userId);

    // If required member capacity is reached, complete the activity
    if (activity.participants.length >= (activity.membersRequired || 1)) {
      activity.status = 'completed';
      activity.completedAt = new Date();
    }

    await activity.save();

    const updated = await Activity.findById(activity._id)
      .populate('user', 'name email')
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email');

    res.json({ message: 'Participant confirmed', activity: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Edit your own post
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });
    if (!userOwnsActivity(activity, req.user.id)) {
      return res.status(403).json({ error: 'You can edit only your own posts' });
    }

    if (req.body.activityType) activity.activityType = req.body.activityType.trim();
    if (req.body.description) activity.description = req.body.description.trim();
    if (req.body.venue) activity.venue = req.body.venue.trim();
    if (req.body.time) activity.time = req.body.time.trim();
    if (req.body.membersRequired) activity.membersRequired = Math.max(1, parseInt(req.body.membersRequired, 10) || 1);
    if (req.body.contactDetails !== undefined) activity.contactDetails = req.body.contactDetails.trim();

    await activity.save();

    const updated = await Activity.findById(activity._id)
      .populate('user', 'name email')
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email');

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Host manually marks post as completed
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

    const updated = await Activity.findById(activity._id)
      .populate('user', 'name email')
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email');

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Delete your own post
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

module.exports = router;
