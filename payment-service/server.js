import express from "express";
import pg from 'pg';

const app = express();
const port = 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const startTime = Date.now();
app.get('/health', async (req, res) => {
  const checks = {}
  let healthy = true

  // Check PostgreSQL
  const dbStart = Date.now()
  try {
    await pool.query('SELECT 1')
    checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart }
  } catch (err) {
    checks.database = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  const body = {
    status: healthy ? 'healthy' : 'unhealthy',
    service: 'payments',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  }

  res.status(healthy ? 200 : 503).json(body)
})

app.listen(port, () => {
  console.log(`Payment Service API running on port ${port}`);
});