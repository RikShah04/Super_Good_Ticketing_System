import express from 'express'
import { createClient } from 'redis'
import pg from 'pg'

const { Pool } = pg

// This version is starter code from website
// https://timdrichards.github.io/426sws/material/prj/docs/health/
const app = express()
const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()
const db = new Pool({ connectionString: process.env.DATABASE_URL })

const QUEUE_NAME = process.env.QUEUE_NAME ?? 'analytics:queue'
const DLQ_NAME = process.env.DLQ_NAME ?? `${QUEUE_NAME}:dlq`

const startTime = Date.now()
let lastJobAt = null
let jobsProcessed = 0

// Your worker loop sets these as it runs
export function recordJobProcessed() {
  lastJobAt = new Date().toISOString()
  jobsProcessed++
}

app.get('/health', async (req, res) => {
  const checks = {}
  let healthy = true

  // Check DB
  const dbStart = Date.now()
  try {
    await db.query('SELECT 1')
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
    const dlqDepth = await redis.lLen(DLQ_NAME)
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
    service: process.env.SERVICE_NAME ?? 'analytics-worker',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  })
})

app.listen(process.env.PORT ?? 3000, () => {
  console.log(`[analytics-worker] listening on ${process.env.PORT ?? 3000}`)
})