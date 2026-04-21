import express from 'express'
import { createClient } from 'redis'
import pg from 'pg'
import { readFile } from 'node:fs/promises'

const { Pool } = pg

// This version is starter code from website
// https://timdrichards.github.io/426sws/material/prj/docs/health/
const app = express()
const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()
const workerRedis = createClient({ url: process.env.REDIS_URL })
await workerRedis.connect()
const db = new Pool({ connectionString: process.env.DATABASE_URL })

const QUEUE_NAME = process.env.QUEUE_NAME ?? 'analytics:queue'
const DLQ_NAME = process.env.DLQ_NAME ?? `${QUEUE_NAME}:dlq`
const ALLOWED_TYPES = new Set(['purchase'])

const startTime = Date.now()
let lastJobAt = null
let jobsProcessed = 0

// Your worker loop sets these as it runs
export function recordJobProcessed() {
  lastJobAt = new Date().toISOString()
  jobsProcessed++
}

async function ensureSchema() {
  const schemaPath = new URL('./db/schema.sql', import.meta.url)
  const sql = await readFile(schemaPath, 'utf8')

  if (!sql.trim()) {
    throw new Error('analytics/db/schema.sql is empty')
  }

  await db.query(sql)
}

function validatePurchaseEvent(job) {
  if (!job || typeof job !== 'object') {
    throw new Error('event payload must be an object')
  }

  if (!ALLOWED_TYPES.has(job.eventType)) {
    throw new Error(`unsupported eventType: ${job.eventType}`)
  }

  if (!job.dedupeKey || !job.eventId || !job.orderId || !job.emittedAt) {
    throw new Error('missing one of required fields: dedupeKey, eventId, orderId, emittedAt')
  }

  const seats = Number(job.seats)
  const priceUsd = Number(job.priceUsd)
  if (!Number.isFinite(seats) || seats <= 0) {
    throw new Error(`invalid seats value: ${job.seats}`)
  }
  if (!Number.isFinite(priceUsd) || priceUsd < 0) {
    throw new Error(`invalid priceUsd value: ${job.priceUsd}`)
  }

  return {
    dedupeKey: String(job.dedupeKey),
    eventType: String(job.eventType),
    sourceService: String(job.sourceService ?? 'unknown'),
    eventId: String(job.eventId),
    orderId: Number(job.orderId),
    paymentId: job.paymentId ? String(job.paymentId) : null,
    seats,
    priceUsd,
    emittedAt: String(job.emittedAt),
    payload: job,
  }
}

async function processPurchaseEvent(event) {
  const inserted = await db.query(
    `INSERT INTO analytics_events
      (dedupe_key, event_type, source_service, event_id, order_id, payment_id, seats, price_usd, emitted_at, payload)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING dedupe_key`,
    [
      event.dedupeKey,
      event.eventType,
      event.sourceService,
      event.eventId,
      event.orderId,
      event.paymentId,
      event.seats,
      event.priceUsd,
      event.emittedAt,
      JSON.stringify(event.payload),
    ]
  )

  if (inserted.rowCount === 0) {
    console.log(`[analytics-worker] duplicate ignored ${event.dedupeKey}`)
    recordJobProcessed()
    return
  }

  await db.query(
    `INSERT INTO event_sales_aggregates (event_id, tickets_sold, gross_revenue, purchase_events, updated_at)
     VALUES ($1, $2, $3, 1, NOW())
     ON CONFLICT (event_id)
     DO UPDATE SET
       tickets_sold = event_sales_aggregates.tickets_sold + EXCLUDED.tickets_sold,
       gross_revenue = event_sales_aggregates.gross_revenue + EXCLUDED.gross_revenue,
       purchase_events = event_sales_aggregates.purchase_events + 1,
       updated_at = NOW()`,
    [event.eventId, event.seats, event.priceUsd]
  )

  console.log(`[analytics-worker] processed purchase ${event.dedupeKey}`)
  recordJobProcessed()
}

async function mainAnalyticsLoop() {
  while (true) {
    const result = await workerRedis.brPop(QUEUE_NAME, 0)
    if (!result?.element) continue

    try {
      const parsed = JSON.parse(result.element)
      const event = validatePurchaseEvent(parsed)
      await processPurchaseEvent(event)
    } catch (err) {
      console.error(`[analytics-worker] moved bad job to DLQ: ${err.message}`)
      await redis.lPush(DLQ_NAME, result.element)
    }
  }
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

await ensureSchema()

app.listen(process.env.PORT ?? 3000, () => {
  console.log(`[analytics-worker] listening on ${process.env.PORT ?? 3000}`)
})

mainAnalyticsLoop().catch(err => {
  console.error('[analytics-worker] worker loop crashed', err)
  process.exit(1)
})