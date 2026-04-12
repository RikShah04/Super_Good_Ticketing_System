import redis from 'redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const HEARTBEAT_MS = parseInt(process.env.HEARTBEAT_MS) || 5000;

const client = redis.createClient({ url: REDIS_URL });
client.on('error', (err) => {
  console.error('Redis error:', err);
});

// Establish heartbeat
setInterval(async () => {
  await client.set('waitlist-heartbeat', Date.now());
}, HEARTBEAT_MS);
