import express from 'express';
import redis from 'redis';
import pg from 'pg';


const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@ticket-purchase-db:5432/ticket-purchase-db';
const SERVICE_NAME = process.env.SERVICE_NAME || 'ticket-purchase';


const app = express();

const client = redis.createClient({ url: REDIS_URL });
client.on('error', (err) => {
  console.error('Redis error:', err);
});
await client.connect();

const db = new pg.Pool({ connectionString: DATABASE_URL });
db.on('error', (err) => {
  console.error('Postgres error:', err);
});

const startTime = Date.now()


app.get('/health', async (req, res) => {
  const checks = {};
  let healthy = true;

  // Check PostgreSQL
  const dbStart = Date.now();
  try {
    await db.query('SELECT 1');
    checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart };
  } catch (err) {
    checks.database = { status: 'unhealthy', error: err.message };
    healthy = false;
  }

  // Check Redis
  const redisStart = Date.now();
  try {
    const pong = await client.ping();
    if (pong !== 'PONG') throw new Error(`unexpected response: ${pong}`);

    checks.redis = { status: 'healthy', latency_ms: Date.now() - redisStart };
  } catch (err) {
    checks.redis = { status: 'unhealthy', error: err.message };
    healthy = false;
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  });
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
