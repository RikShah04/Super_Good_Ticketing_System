import express from 'express';
import redis from 'redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const WAITLIST_WORKER_TIMEOUT_MS = parseInt(process.env.WAITLIST_WORKER_TIMEOUT_MS) || 10000;

const app = express();

const client = redis.createClient({ url: REDIS_URL });
client.on('error', (err) => {
  console.error('Redis error:', err);
});


app.get('/health', async (req, res) => {
  // TODO: check health of DLQ, queues
  const unhealthyDependencies = [];

  const redisResponse = await client.ping();
  if (redisResponse !== 'PONG')
    unhealthyDependencies.push('Redis: unreachable');

  const waitlistHeartbeat = Date.parse(await client.get('waitlist-heartbeat'));
  const now = Date.now();
  if (!waitlistHeartbeat || (now - waitlistHeartbeat) > WAITLIST_WORKER_TIMEOUT_MS)
    unhealthyDependencies.push('Waitlist worker: no recent heartbeat');

  unhealthyDependencies.length > 0
    ? res.status(503).json({ status: 'unhealthy', unhealthyDependencies })
    : res.status(200).json({ status: 'healthy' });
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
