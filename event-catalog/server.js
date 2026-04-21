import express from 'express';
import redis from 'redis';
import pg from 'pg';
import validator from 'validator';

const app = express();
const port = Number(process.env.PORT || '3005');
const SERVICE_NAME = process.env.SERVICE_NAME || 'event-catalog';

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

app.get('/events', async (req, res) => {
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
            return res.json(JSON.parse(cached));
        }

        // Not in redis? query the db
        let baseQuery = `FROM eventcatalog`;
        const params = [];
        const conditions = [];

        if (venue) {
            params.push(`%${venue}%`);
            conditions.push(`venue ILIKE $${params.length}`);
        }

        if (conditions.length > 0) {
            baseQuery += " WHERE " + conditions.join(" AND ");
        }

        // Count query (exclude limit + offset)
        const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);
        const total = parseInt(countResult.rows[0].count, 10);

        // Data query (include limit + offset)
        params.push(limit);
        params.push(offset);

        const dataQuery = `SELECT * ${baseQuery} ORDER BY eventdate ASC LIMIT $${params.length - 1} OFFSET $${params.length}`;

        const result = await pool.query(dataQuery, params);

        const rows = result.rows;

        const response = {
            page,
            limit,
            total,
            events: result.rows,
        };
        // Cache results in redis
        await client.setEx(cacheKey, 60, JSON.stringify(response));

        res.json(response);

    } catch (err) {
        console.error("GET /events failed:", err);

        res.status(503).json({
            error: "Database or Redis unavailable",
            details: err.message,
        });
    }
});

app.get('/events/:id', async (req, res) => {
    const id = req.params.id;

    // Validate the format of the id
    if (!validator.isUUID(id)) {
        return res.status(400).json({ error: "Invalid event ID format." });
    }

    const cacheKey = `event:${id}`;

    try {
        // Try Redis cache first
        const cached = await client.get(cacheKey);
        if (cached) {
            return res.json(JSON.parse(cached));
        }

        // Not in the cache, to the DB it is!
        const result = await pool.query(`SELECT * FROM eventcatalog where id = $1`, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Event not found."});
        }

        const event = result.rows[0];

        // Now we cache it
        await client.setEx(cacheKey, 60, JSON.stringify(event));

        res.json(event);
        
    } catch (err) {
        console.error("GET /events/:id failed: ", err);

        res.status(503).json({
            error: "Database or Redis unavailable",
            details: err.message,
        });
    }
});

app.post("/reserve-seats", async (req, res) => {
    const { event_id, seats } = req.body;

    if (!event_id || !Number.isInteger(seats) || seats <= 0) {
        return res.status(400).json({
            message: 'Missing or invalid event_id or seats.'
        });
    }

    const db = await pool.connect();
    try {
        await db.query('BEGIN');

        const eventResult = await db.query(
            'SELECT id, availableseats, priceusd FROM eventcatalog WHERE id = $1 FOR UPDATE',
            [event_id]
        );

        if (eventResult.rowCount === 0) {
            await db.query('ROLLBACK');
            return res.status(404).json({ message: 'Event not found.' });
        }

        const event = eventResult.rows[0];

        if (seats > event.availableseats) {
            await db.query('ROLLBACK');
            return res.status(409).json({ message: 'No more seats for this event.' });
        }

        await db.query(
            'UPDATE eventcatalog SET availableseats = availableseats - $1 WHERE id = $2',
            [seats, event_id]
        );

        await db.query('COMMIT');
        return res.status(200).json({
            message: 'Purchase Successful!',
            cost: event.priceusd,
            seatsReserved: seats
        });
    } catch (err) {
        await db.query('ROLLBACK');
        console.error('Failed to reserve seats:', err.message);
        return res.status(500).json({ message: 'Failed to reserve seats.' });
    } finally {
        db.release();
    }
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