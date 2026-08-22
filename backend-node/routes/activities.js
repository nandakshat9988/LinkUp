const express = require('express');
const Activity = require('../models/Activity');
const requireAuth = require('../middleware/auth');
const { getDynamicRadiusKm } = require('../utils/geo');

const router = express.Router();

function userOwnsActivity(activity, userId) {
  const ownerId = activity.user._id || activity.user;
  return ownerId.toString() === userId;
}

// Utility: Automatically marks past events as completed based on scheduled eventDate
async function autoExpirePastActivities() {
  try {
    await Activity.updateMany(
      {
        eventDate: { $lte: new Date() },
        status: 'open'
      },
      {
        $set: { status: 'completed', completedAt: new Date() }
      }
    );
  } catch (e) {
    console.error('Error auto-expiring activities:', e.message);
  }
}

// 1. Create a new activity post with scheduled eventDate
router.post('/', requireAuth, async (req, res) => {
  try {
    const { activityType, description, venue, time, eventDate, membersRequired, contactDetails, lat, lng } = req.body;

    if (!activityType || !description || !venue || !eventDate || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Activity type, description, venue, event date/time, and location are required' });
    }

    const parsedEventDate = new Date(eventDate);
    if (isNaN(parsedEventDate.getTime())) {
      return res.status(400).json({ error: 'Invalid event date & time format' });
    }

    // Format a clean display time string if not provided
    const displayTime = (time || parsedEventDate.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })).trim();

    const activity = await Activity.create({
      user: req.user.id,
      activityType: activityType.trim(),
      description: description.trim(),
      venue: venue.trim(),
      time: displayTime,
      eventDate: parsedEventDate,
      membersRequired: Math.max(1, parseInt(membersRequired, 10) || 1),
      contactDetails: (contactDetails || '').trim(),
      location: { type: 'Point', coordinates: [lng, lat] },
      joinRequests: [],
      participants: [],
      messages: []
    });

    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Public feed (newest open, upcoming posts first)
router.get('/', async (req, res) => {
  try {
    await autoExpirePastActivities();

    const activities = await Activity.find({
      status: 'open',
      eventDate: { $gt: new Date() }
    })
      .sort({ eventDate: 1, createdAt: -1 })
      .limit(50)
      .populate('user', 'name email')
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email');

    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Completed events feed (past event date or full/completed matches)
router.get('/completed', async (req, res) => {
  try {
    await autoExpirePastActivities();

    const activities = await Activity.find({
      $or: [
        { status: 'completed' },
        { eventDate: { $lte: new Date() } }
      ]
    })
      .sort({ eventDate: -1, completedAt: -1, createdAt: -1 })
      .limit(50)
      .populate('user', 'name email')
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email');

    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Posts created by the logged-in user
router.get('/mine', requireAuth, async (req, res) => {
  try {
    await autoExpirePastActivities();

    const activities = await Activity.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email');

    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Live events the logged-in user has joined and been confirmed in by the host
router.get('/joined', requireAuth, async (req, res) => {
  try {
    await autoExpirePastActivities();

    const activities = await Activity.find({
      participants: req.user.id,
      eventDate: { $gt: new Date() }
    })
      .sort({ eventDate: 1 })
      .populate('user', 'name email')
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email');

    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Nearby search using MongoDB 2dsphere index (open upcoming events only)
router.get('/nearby', async (req, res) => {
  try {
    await autoExpirePastActivities();

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
      {
        $match: {
          status: 'open',
          eventDate: { $gt: new Date() }
        }
      },
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

// 7. Get a single activity by ID (with expiration check & populated messages)
router.get('/:id', async (req, res) => {
  try {
    let activity = await Activity.findById(req.params.id)
      .populate('user', 'name email')
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email')
      .populate('messages.sender', 'name email');

    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    // Check expiration on-the-fly (only expires when eventDate <= now)
    if (activity.eventDate && new Date(activity.eventDate) <= new Date() && activity.status !== 'completed') {
      activity.status = 'completed';
      activity.completedAt = activity.completedAt || new Date();
      await activity.save();
    }

    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. User submits a request to join an activity post
router.post('/:id/request-join', requireAuth, async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    if (activity.eventDate && new Date(activity.eventDate) <= new Date()) {
      activity.status = 'completed';
      await activity.save();
      return res.status(400).json({ error: 'This activity has already passed and is completed' });
    }

    if (activity.status === 'completed') {
      return res.status(400).json({ error: 'This activity is already completed' });
    }

    if (activity.participants.length >= (activity.membersRequired || 1)) {
      return res.status(400).json({ error: 'This activity has reached full member capacity' });
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
      .populate('joinRequests', 'name email')
      .populate('messages.sender', 'name email');

    res.json({ message: 'Join request sent to host successfully', activity: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Host confirms a participant from pending join requests
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

    // Note: The event stays OPEN until the actual scheduled eventDate arrives,
    // even if member capacity is full, so host and confirmed members can chat.
    await activity.save();

    const updated = await Activity.findById(activity._id)
      .populate('user', 'name email')
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email')
      .populate('messages.sender', 'name email');

    res.json({ message: 'Participant confirmed', activity: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 10. Send a message on an activity post (accessible to Host & Confirmed Participants while event is active)
router.post('/:id/messages', requireAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }

    const activity = await Activity.findById(req.params.id);
    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    // Check if event time has passed
    const isPastEvent = activity.eventDate && new Date(activity.eventDate) <= new Date();
    if (isPastEvent || activity.status === 'completed') {
      if (activity.status !== 'completed') {
        activity.status = 'completed';
        activity.completedAt = activity.completedAt || new Date();
        await activity.save();
      }
      return res.status(400).json({ error: 'Event date and time has passed. Messaging is disabled for completed events.' });
    }

    // Access control: Caller must be Host or Confirmed Participant
    const isHost = userOwnsActivity(activity, req.user.id);
    const isParticipant = activity.participants.some(p => p.toString() === req.user.id);

    if (!isHost && !isParticipant) {
      return res.status(403).json({ error: 'Only the host and confirmed participants can chat.' });
    }

    const newMessage = {
      sender: req.user.id,
      text: text.trim(),
      createdAt: new Date()
    };

    activity.messages.push(newMessage);
    await activity.save();

    const updated = await Activity.findById(activity._id)
      .populate('user', 'name email')
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email')
      .populate('messages.sender', 'name email');

    res.json({
      message: 'Message sent',
      messages: updated.messages,
      activity: updated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 11. Fetch messages for an activity (accessible to Host & Confirmed Participants)
router.get('/:id/messages', requireAuth, async (req, res) => {
  try {
    const activity = await Activity.findById(req.params.id)
      .populate('messages.sender', 'name email');

    if (!activity) return res.status(404).json({ error: 'Activity not found' });

    const isHost = userOwnsActivity(activity, req.user.id);
    const isParticipant = activity.participants.some(p => p.toString() === req.user.id);

    if (!isHost && !isParticipant) {
      return res.status(403).json({ error: 'Only the host and confirmed participants can view messages.' });
    }

    const isExpired = (activity.eventDate && new Date(activity.eventDate) <= new Date()) || activity.status === 'completed';

    res.json({
      isExpired,
      messages: activity.messages || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 12. Edit your own post
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
    if (req.body.eventDate) activity.eventDate = new Date(req.body.eventDate);
    if (req.body.membersRequired) activity.membersRequired = Math.max(1, parseInt(req.body.membersRequired, 10) || 1);
    if (req.body.contactDetails !== undefined) activity.contactDetails = req.body.contactDetails.trim();

    await activity.save();

    const updated = await Activity.findById(activity._id)
      .populate('user', 'name email')
      .populate('participants', 'name email')
      .populate('joinRequests', 'name email')
      .populate('messages.sender', 'name email');

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 13. Host manually marks post as completed
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
      .populate('joinRequests', 'name email')
      .populate('messages.sender', 'name email');

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 14. Delete your own post
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

