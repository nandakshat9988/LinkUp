const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { createClient } = require('redis');

let rateLimitStore;

if (process.env.REDIS_URL) {
  try {
    const redisClient = createClient({ url: process.env.REDIS_URL });
    redisClient.on('error', (err) => console.warn('Redis warning:', err.message));
    redisClient.connect()
      .then(() => console.log('Connected to Redis for rate limiting'))
      .catch((err) => console.warn('Redis connection failed, continuing with in-memory store:', err.message));

    rateLimitStore = new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args)
    });
  } catch (err) {
    console.warn('Failed to initialize Redis store, falling back to memory store:', err.message);
  }
} else {
  console.log('REDIS_URL not set — using in-memory rate limiting.');
}

const limiterOptions = {
  windowMs: 60 * 1000,   // 1 minute window
  max: 30,                // 30 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down.' }
};

if (rateLimitStore) {
  limiterOptions.store = rateLimitStore;
}

const locationRateLimiter = rateLimit(limiterOptions);

module.exports = locationRateLimiter;
