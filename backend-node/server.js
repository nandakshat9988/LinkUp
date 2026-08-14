require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const connectDB = require('./config/db');
const locationRateLimiter = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const activityRoutes = require('./routes/activities');
const recommendationRoutes = require('./routes/recommendations');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

connectDB();

// Health check endpoints for Render / monitoring
app.get(['/health', '/healthz', '/api/health'], (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);

// Rate limiting is applied only to the location-sensitive endpoints — these
// are the ones scrapers/bots would hammer to harvest user coordinates.
app.use('/api/activities', locationRateLimiter, activityRoutes);
app.use('/api/recommendations', locationRateLimiter, recommendationRoutes);

// Serve frontend static assets (HTML, CSS, JS)
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

// Fallback to index.html for non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(frontendPath, 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
