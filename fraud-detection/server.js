import express from 'express'
import { createClient } from 'redis'
import pg from 'pg'

const { Pool } = pg

const app = express()
const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

const workerRedis = createClient({ url: process.env.REDIS_URL })
await workerRedis.connect()

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

const QUEUE_NAME = process.env.FRAUD_QUEUE_KEY ?? 'fraud:queue'
const DLQ_NAME = process.env.FRAUD_DLQ_KEY ?? `${QUEUE_NAME}:dlq`

const startTime = Date.now()
let lastJobAt = null
let jobsProcessed = 0

// Your worker loop sets these as it runs
export function recordJobProcessed() {
  lastJobAt = new Date().toISOString()
  jobsProcessed++
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fraud_results (
      id SERIAL PRIMARY KEY,
      client_order_id TEXT UNIQUE NOT NULL,
      user_id TEXT,
      amount NUMERIC,
      flagged BOOLEAN NOT NULL
    )
  `)
}

app.get('/health', async (req, res) => {
  const checks = {}
  let healthy = true

  // Check DB
  const dbStart = Date.now()
  try {
    await pool.query('SELECT 1')
    checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart }
  } catch (err) {
    checks.database = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  // Check Redis
  const redisStart = Date.now()
  try {
    const pong = await redis.ping()
    if (pong !== 'PONG') throw new Error(`unexpected response: ${pong}`)
    checks.redis = { status: 'healthy', latency_ms: Date.now() - redisStart }
  } catch (err) {
    checks.redis = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  // Check queue depth — flag if backlog is growing
  try {
    const depth = await redis.lLen(QUEUE_NAME)
    const dlqDepth = await redis.lLen(
      DLQ_NAME ?? `${QUEUE_NAME}:dlq`
    )
    checks.queue = {
      status: depth < 1000 ? 'healthy' : 'degraded',
      depth,
      dlq_depth: dlqDepth,
    }
    if (dlqDepth > 0) checks.queue.status = 'degraded' // any DLQ entries are worth surfacing
  } catch (err) {
    checks.queue = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  // Check that the worker is actually processing jobs
  const secondsSinceLastJob = lastJobAt
    ? (Date.now() - new Date(lastJobAt).getTime()) / 1000
    : null

  checks.worker = {
    status:
      secondsSinceLastJob === null || secondsSinceLastJob < 60
        ? 'healthy'
        : 'degraded',
    last_job_at: lastJobAt ?? 'never',
    jobs_processed: jobsProcessed,
    seconds_since_last_job: secondsSinceLastJob,
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: process.env.SERVICE_NAME ?? 'fraud-worker',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  })
})

async function workerLoop() {
  while (true) {
    try {
      const result = await workerRedis.brPop(QUEUE_NAME, 0)
      if (!result?.element) continue
      
      const job = JSON.parse(result.element)
      console.log('[fraud-worker] processed', job.clientOrderId ?? 'unknown')
      recordJobProcessed()
    } catch (err) {
      console.error('[fraud-worker] loop error', err.message)
    }
  }
}

app.listen(process.env.PORT ?? 3000, () => {
  console.log(`[fraud-worker] listening on ${process.env.PORT ?? 3000}`)
})

workerLoop().catch(err => {
  console.error('[fraud-worker] startup error', err)
  process.exit(1)
})