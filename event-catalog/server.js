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

app.post("/reserve-seats", async (req, res) => {
    const { event_id, seats } = req.body;

    if (!event_id || !seats || seats <= 0) {
        return res.json({
            status: 400,
            message: "Missing or invalid event_id or seats."
        });
    }
    const raw = await client.get(event_id);
    if (!raw) {
        return res.json({
            status: 404,
            message: "Event not found."    
        });
    }

    const event = JSON.parse(raw);
    if (event.availableSeats > 0 && seats <= event.availableSeats) {
        event.availableSeats -= seats;
        await client.set(event_id, JSON.stringify(event));
        return res.json({
            status: 200,
            message: "Purchase Successful!",
            cost : event.priceUsd
        });
    } else {
        return res.json({
            status: 409,
            message: "No more seats for this event."    
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