import express from 'express';
import redis from 'redis';
import pg from 'pg';

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
    try {
        const result = await pool.query(`
            SELECT
                id,
                name,
                venue,
                eventdate AS "eventDate",
                totalseats AS "totalSeats",
                availableseats AS "availableSeats",
                priceusd AS "priceUsd"
            FROM eventcatalog
            ORDER BY eventdate ASC
        `);

        res.json(result.rows);
    } catch (err) {
        console.error('Failed to fetch events:', err.message);
        res.status(500).json({ message: 'Failed to fetch events.' });
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