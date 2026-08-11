require('dotenv').config();
const express = require('express');
const cors = require('cors');

const connectDB = require('./config/db');
const locationRateLimiter = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const activityRoutes = require('./routes/activities');
const recommendationRoutes = require('./routes/recommendations');

const app = express();
app.use(cors());
app.use(express.json());

connectDB();

app.use('/api/auth', authRoutes);

// Rate limiting is applied only to the location-sensitive endpoints — these
// are the ones scrapers/bots would hammer to harvest user coordinates.
app.use('/api/activities', locationRateLimiter, activityRoutes);
app.use('/api/recommendations', locationRateLimiter, recommendationRoutes);

app.listen(3000, () => {
  console.log('Node.js server running on http://localhost:3000');
});
