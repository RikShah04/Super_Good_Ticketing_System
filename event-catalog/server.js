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
    // Default page is 1
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    // Default is 20, hard limit at 100.
    const limit = Math.min(
        Math.max(parseInt(req.query.limit || "20", 10), 1),
        100
    );
    const venue = req.query.venue || "";

    const offset = (page - 1) * limit;

    // Create the Redis cache key
    const cacheKey = `events:${page}:${limit}:${venue}`;

    try {
        // Check if Redis has the event cached already
        const cached = await client.get(cacheKey);

        if (cached) {
            return res.json({
                page,
                limit,
                total,
                events: JSON.parse(cached),
            });
        }

        // Not in redis? query the db
        let query = `SELECT * FROM eventcatalog`;
        const params = [];
        const conditions = [];

        if (venue) {
            params.push(`%${venue}%`);
            conditions.push(`venue ILIKE ${params.length}`);
        }

        if (conditions.length > 0) {
            query += " WHERE " + conditions.join(" AND ");
        }

        params.push(limit);
        params.push(offset);

        query += `ORDER BY eventdate ASC LIMIT $${params.length - 1} OFFSET $${params.length}`;

        const result = await pool.query(query, params);

        const rows = result.rows;

        // Cache results in redis
        await client.setEx(
            cacheKey,
            60,
            JSON.stringify(result.rows)
        );

        res.json({
            page,
            limit,
            total: rows.length,
            events: result.rows,
        });

    } catch (err) {
        console.error("GET /events failed:", err);

        res.status(503).json({
            error: "Database or Redis unavailable",
            details: err.message,
        });
    }
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        service: SERVICE_NAME,
        timestamp: new Date().toISOString()
    });
});

app.listen(port, () => {
    console.log(`Event catalog service listening on: ${port}`);
});