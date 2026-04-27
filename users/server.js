import express from 'express';
import redis from 'redis';
import pg from 'pg';
import validator from 'validator';

const app = express();
const port = Number(process.env.PORT || '3006');
const SERVICE_NAME = process.env.SERVICE_NAME || 'users';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@users-db:5432/users-db';
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

app.get('/users', async (req, res) => {
    // Users db intended for simulation and testing purposes, not actual user storage and sensitive information
    const limit = Math.min(Math.max(parseInt(req.query.limit || "5", 10), 1), 100);
    const cacheKey = `users:${limit}`;

    try {
        // Check if users list already cached in Redis
        const cached = await client.get(cacheKey);

        if (cached) {
            return res.json(JSON.parse(cached));
        }

        let baseQuery = `FROM users`;
        const params = [];
        const conditions = [];

        params.push(limit);

        const dataQuery = `SELECT * ${baseQuery} ORDER BY RANDOM() LIMIT $${params.length}`;

        const result = await pool.query(dataQuery, params);

        const rows = result.rows;

        const response = {
            limit,
            users: result.rows,
        };

        // Cache results in redis
        await client.setEx(cacheKey, 60, JSON.stringify(response));

        res.json(response);
    } catch  (err) {
        console.error("GET /users failed: ", err);

        res.status(503).json({
            error: "Database or Redis unavailable",
            details: err.message,
        });
    }
});

app.get('/users/:id', async (req, res) => {
    const id = req.params.id;

    // Validate id format
    if (!validator.isUUID(id)) {
        return res.status(400).json({ error: "Invalid user ID format." });
    }

    const cacheKey = `user:${id}`;

    try {
        // Check cache
        const cached = await client.get(cacheKey);
        if (cached) {
            const user = JSON.parse(cached);
            return res.json(user);
        }

        // User not cached
        const result = await pool.query(`SELECT * FROM users where userid = $1`, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Event not found."});
        }

        const user = result.rows[0];

        // Cache located user
        await client.setEx(cacheKey, 60, JSON.stringify(user));

        res.json(user);
    } catch (err) {
        console.error("GET /users/:id failed: ", err);

        res.status(503).json({
            error: "Database or redis unavailable",
            details: err.message,
        });
    }
});

app.get('/health', async (_req, res) => {
    let healthy = true;
    let dbStats = {};

    // Check users DB
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
        database: dbStats,
    });
});

app.listen(port, () => {
    console.log(`Users service listening on: ${port}`);
});