const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { createClient } = require('redis');

const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.on('error', (err) => console.log('Redis error:', err.message));
redisClient.connect().catch((err) => console.log('Redis connection failed:', err.message));

// Why Redis and not a plain in-memory counter (like express-rate-limit's
// default store)? An in-memory counter resets whenever the server restarts
// and — more importantly — is PER PROCESS. Once this app runs as multiple
// containers/instances behind a load balancer, each instance would have its
// own separate counter and the real limit becomes (instances x max), which
// defeats the point. Redis gives every instance a single shared counter.
const locationRateLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute window
  max: 30,                // 30 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args)
  }),
  message: { error: 'Too many requests — slow down.' }
});

module.exports = locationRateLimiter;
