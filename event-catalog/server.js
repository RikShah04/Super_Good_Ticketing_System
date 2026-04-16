import express from 'express';
import redis from 'redis';
import pg from 'pg';
import { makeEvent } from './seedEvents.js';

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

// Seed pg with data
async function seed() {
    await pool.connect();
    for (let i = 0; i < 10; i++) {
        event = makeEvent();
        keys = Object.keys(event);
        values = Object.values(event);
        
        // Generate placeholders (prevent SQL injection attacks)
        const placeholders = keys.map((_, j) => `$${i+1}`).join(', ');
        const columns = keys.join(', ');
        query = `INSERT INTO eventCatalog(${columns}) VALUES (${placeholders})`;
        await pool.query(query, values);
    }
    await client.end();
}

const client = redis.createClient({ url: redisUrl });

client.on('error', err => {
    console.error('Redis error: ', err.message);
});

await client.connect();

app.use(express.json());

app.get('/events', (req, res) => {
    res.json(events);
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