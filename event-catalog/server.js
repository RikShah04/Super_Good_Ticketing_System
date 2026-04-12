import express from 'express'
import redis from 'redis'

const app = express();
const port = Number(process.env.PORT || '8000');
const events = {};

const redisUrl = process.env.REDIS_URL || 'redis://redis:6379';

const client = redis.createClient({ url: redisUrl });

client.on('error', err => {
    console.error('Redis error: ', err.message);
});

await client.connect();

app.use(express.json());

app.get('/events', (req, res) => {
    res.json(events);
});

app.listen(port, () => {
    console.log(`Event catalog service listening on: ${port}`);
});