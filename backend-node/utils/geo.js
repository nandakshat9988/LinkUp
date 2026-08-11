const Activity = require('../models/Activity');

// Dynamic radius: dense areas get a tight radius (2km), sparse areas get a
// wide one (15km). A real system might pull this from census/population
// data — here we use a simple, explainable proxy instead: count how many
// activities already exist nearby, and use that as our "density" signal.
const RADIUS_TIERS = [
  { minCount: 8, radiusKm: 2 },   // dense / urban
  { minCount: 3, radiusKm: 7 },   // medium density
  { minCount: 0, radiusKm: 15 }   // sparse / rural
];

const PROBE_RADIUS_METERS = 5000; // fixed 5km probe used only to measure density

async function getDynamicRadiusKm(lng, lat) {
  const count = await Activity.countDocuments({
    location: {
      $nearSphere: {
        $geometry: { type: 'Point', coordinates: [lng, lat] },
        $maxDistance: PROBE_RADIUS_METERS
      }
    }
  });

  const tier = RADIUS_TIERS.find(t => count >= t.minCount);
  return tier.radiusKm;
}

module.exports = { getDynamicRadiusKm };
