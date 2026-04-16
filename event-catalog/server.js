import express from 'express';
import redis from 'redis';
import pg from 'pg';

const app = express();
const port = Number(process.env.PORT || '3005');
const SERVICE_NAME = process.env.SERVICE_NAME || 'event-catalog';
const events = {};

const DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@events-db:5432/events-db"
const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

const pool = new pg.Pool({ connectionString: DATABASE_URL });

pool.on('error', err => {
    console.error('Postgres error: ', err.message);
});

const client = redis.createClient({ url: redisUrl });

client.on('error', err => {
    console.error('Redis error: ', err.message);
});

await client.connect();

app.use(express.json());

app.get('/events', (req, res) => {
    res.json(events);
});

app.get('/health', async (_req, res) => {
    let healthy = true;
    let redisStats = {};
    let dbStats = {};

    //check Redis
    const redisCheck = Date.now();
    try{
        const pong = await client.ping();
        if (pong !== 'PONG') throw new Error(`Redis: Unexpected response: ${pong}`);

        redisStats = { status: 'healthy', latency_ms: Date.now() - redisCheck };
    } catch (err) {
        redisStats = { status: 'unhealthy', error: err.message };
        healthy = false;
    }

    // check events DB
    const dbCheck = Date.now();
    try {
        await pool.query('SELECT 1');
        dbStats = { status: 'healthy', latency_ms: Date.now() - dbCheck };
    } catch (err) {
        dbStats = { status: 'unhealthy', error: err.message };
        healthy = false;
    }

    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'healthy' : 'unhealthy',
        service: SERVICE_NAME,
        timestamp: new Date().toISOString(),
        redis: redisStats,
        database: dbStats,
    });
});

app.listen(port, () => {
    console.log(`Event catalog service listening on: ${port}`);
});