import express from 'express';
import redis from 'redis';
import pg from 'pg';

const app = express();
const port = Number(process.env.PORT || '3006');
const SERVICE_NAME = process.env.SERVICE_NAME || 'users';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@users-db:5432/users-db';

const pool = new pg.Pool({ connectionString: DATABASE_URL });

pool.on('error', err => {
    console.error('Postgres error: ', err.message);
});

app.use(express.json());

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