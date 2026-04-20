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
const FLAGGED_CHANNEL = process.env.FRAUD_FLAGGED_CHANNEL ?? 'fraud:flagged'
const RESULT_CHANNEL = process.env.FRAUD_RESULT_CHANNEL ?? 'fraud:result'
const RESULT_KEY_PREFIX = process.env.FRAUD_RESULT_KEY_PREFIX ?? 'fraud:result:'

const HIGH_PRICE_THRESHOLD = Number(process.env.FRAUD_HIGH_PRICE_THRESHOLD ?? 500)
const MAX_SEATS_THRESHOLD = Number(process.env.FRAUD_MAX_SEATS_THRESHOLD ?? 6)
const CARD_ATTEMPT_LIMIT = Number(process.env.FRAUD_CARD_ATTEMPT_LIMIT ?? 4)

const startTime = Date.now()
let lastJobAt = null
let jobsProcessed = 0

export function recordJobProcessed() {
  lastJobAt = new Date().toISOString()
  jobsProcessed++
}

function getCardLast4(cc) {
  return String(cc).slice(-4)
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fraud_results (
      id SERIAL PRIMARY KEY,
      payment_id TEXT UNIQUE NOT NULL,
      order_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      seat_count INTEGER NOT NULL,
      seats JSONB NOT NULL,
      card_type TEXT NOT NULL,
      card_last4 TEXT NOT NULL,
      price NUMERIC NOT NULL,
      flagged BOOLEAN NOT NULL,
      reason TEXT NOT NULL,
      raw_event JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
}

function validateJob(job) {
  if (!job || typeof job !== 'object') {
    throw new Error('job must be an object')
  }

  if (!job.event_id) {
    throw new Error('missing event_id')
  }

  if (!job.paymentID) {
    throw new Error('missing paymentID')
  }

  if (!job.orderID) {
    throw new Error('missing orderID')
  }

  if (!Array.isArray(job.seats)) {
    throw new Error('seats must be an array')
  }

  if (job.seats.length === 0) {
    throw new Error('seats cannot be empty')
  }

  if (!job.cc || typeof job.cc !== 'string') {
    throw new Error('missing or invalid cc')
  }

  if (job.cc.length < 15 || job.cc.length > 16) {
    throw new Error('cc must be a 15-16 digit string')
  }

  if (!/^\d{15,16}$/.test(job.cc)) {
    throw new Error('cc must contain only digits')
  }

  if (!job.cardType || !['Visa', 'Amex', 'Master'].includes(job.cardType)) {
    throw new Error('invalid cardType')
  }

  if (job.price == null || Number.isNaN(Number(job.price))) {
    throw new Error('missing or invalid price')
  }

  if (Number(job.price) < 0) {
    throw new Error('price cannot be negative')
  }
}

async function determineFraud(job) {
  const price = Number(job.price)
  const seatCount = job.seats.length
  const cardLast4 = getCardLast4(job.cc)

  if (price > HIGH_PRICE_THRESHOLD) {
    return { flagged: true, reason: 'price_over_threshold' }
  }

  if (seatCount > MAX_SEATS_THRESHOLD) {
    return { flagged: true, reason: 'too_many_seats' }
  }

  const recentAttemptKey = `fraud:card:${cardLast4}:attempts`
  const attempts = await redis.incr(recentAttemptKey)
  if (attempts === 1) {
    await redis.expire(recentAttemptKey, 60)
  }

  if (attempts > CARD_ATTEMPT_LIMIT) {
    return { flagged: true, reason: 'too_many_attempts_same_card_last4' }
  }

  return { flagged: false, reason: 'passed_basic_rules' }
}

async function saveFraudResult(job, result) {
  const cardLast4 = getCardLast4(job.cc)

  await pool.query(
    `
      INSERT INTO fraud_results
        (payment_id, order_id, event_id, seat_count, seats, card_type, card_last4, price, flagged, reason, raw_event)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (payment_id)
      DO UPDATE SET
        order_id = EXCLUDED.order_id,
        event_id = EXCLUDED.event_id,
        seat_count = EXCLUDED.seat_count,
        seats = EXCLUDED.seats,
        card_type = EXCLUDED.card_type,
        card_last4 = EXCLUDED.card_last4,
        price = EXCLUDED.price,
        flagged = EXCLUDED.flagged,
        reason = EXCLUDED.reason,
        raw_event = EXCLUDED.raw_event
    `,
    [
      job.paymentID,
      job.orderID,
      job.event_id,
      job.seats.length,
      JSON.stringify(job.seats),
      job.cardType,
      cardLast4,
      Number(job.price),
      result.flagged,
      result.reason,
      JSON.stringify({
        event_id: job.event_id,
        seats: job.seats,
        cardType: job.cardType,
        price: Number(job.price),
        paymentID: job.paymentID,
        orderID: job.orderID,
        cardLast4,
      }),
    ]
  )
}

async function publishFraudResult(job, result) {
  const payload = {
    paymentID: job.paymentID,
    orderID: job.orderID,
    event_id: job.event_id,
    flagged: result.flagged,
    reason: result.reason,
    processedAt: new Date().toISOString(),
  }

  await redis.set(
    `${RESULT_KEY_PREFIX}${job.paymentID}`,
    JSON.stringify(payload),
    { EX: 3600 }
  )

  await redis.publish(RESULT_CHANNEL, JSON.stringify(payload))

  if (result.flagged) {
    await redis.publish(FLAGGED_CHANNEL, JSON.stringify(payload))
  }

  return payload
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

      let job
      try {
        job = JSON.parse(result.element)
      } catch (err) {
        console.error('[fraud-worker] invalid JSON, moving to DLQ')
        await redis.rPush(DLQ_NAME, result.element)
        continue
      }

      try {
        validateJob(job)

        console.log(
          '[fraud-worker] received fraud-check event',
          JSON.stringify({
            paymentID: job.paymentID,
            orderID: job.orderID,
            event_id: job.event_id,
            seatCount: job.seats.length,
            cardType: job.cardType,
            price: Number(job.price),
            cardLast4: getCardLast4(job.cc),
          })
        )

        const decision = await determineFraud(job)
        await saveFraudResult(job, decision)
        const published = await publishFraudResult(job, decision)

        console.log(
          '[fraud-worker] completed fraud-check',
          JSON.stringify(published)
        )

        recordJobProcessed()
      } catch (err) {
        console.error(
          '[fraud-worker] failed processing job, moving to DLQ:',
          err.message
        )

        await redis.rPush(
          DLQ_NAME,
          JSON.stringify({
            originalJob: {
              paymentID: job?.paymentID,
              orderID: job?.orderID,
              event_id: job?.event_id,
            },
            error: err.message,
            failedAt: new Date().toISOString(),
          })
        )
      }
    } catch (err) {
      console.error('[fraud-worker] loop error', err.message)
    }
  }
}

async function start() {
  await initDb()

  app.listen(process.env.PORT ?? 3000, () => {
    console.log(`[fraud-worker] listening on ${process.env.PORT ?? 3000}`)
  })

  workerLoop().catch(err => {
    console.error('[fraud-worker] startup error', err)
    process.exit(1)
  })
}

start().catch(err => {
  console.error('[fraud-worker] failed to start', err)
  process.exit(1)
})