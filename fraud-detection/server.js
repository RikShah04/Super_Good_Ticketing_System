import express from 'express'
import { createClient } from 'redis'
import pg from 'pg'

const { Pool } = pg

const app = express()
const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

const workerRedis = createClient({ url: process.env.REDIS_URL })
await workerRedis.connect()

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 1000),
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS ?? 1000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 1000),
})

const QUEUE_NAME = process.env.FRAUD_QUEUE_KEY ?? 'fraud:queue'
const DLQ_NAME = process.env.FRAUD_DLQ_KEY ?? `${QUEUE_NAME}:dlq`
const FLAGGED_CHANNEL = process.env.FRAUD_FLAGGED_CHANNEL ?? 'fraud:flagged'
const RESULT_CHANNEL = process.env.FRAUD_RESULT_CHANNEL ?? 'fraud:result'
const RESULT_KEY_PREFIX = process.env.FRAUD_RESULT_KEY_PREFIX ?? 'fraud:result:'

const REFUND_URL = process.env.REFUND_URL ?? 'http://refund:3000'
const REFUND_TIMEOUT_MS = Number(process.env.REFUND_TIMEOUT_MS ?? 5000)

const HIGH_PRICE_THRESHOLD = Number(process.env.FRAUD_HIGH_PRICE_THRESHOLD ?? 500)
const MAX_SEATS_THRESHOLD = Number(process.env.FRAUD_MAX_SEATS_THRESHOLD ?? 6)
const CARD_ATTEMPT_LIMIT = Number(process.env.FRAUD_CARD_ATTEMPT_LIMIT ?? 4)
const PROCESSING_MAX_RETRIES = Number(process.env.FRAUD_MAX_RETRIES ?? 3)
const PROCESSING_BACKOFF_MS = Number(process.env.FRAUD_BACKOFF_MS ?? 500)

const startTime = Date.now()
let lastJobAt = null
let jobsProcessed = 0

export function recordJobProcessed() {
  lastJobAt = new Date().toISOString()
  jobsProcessed++
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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

  if (!job.eventID){
    throw new Error('missing eventID')
  }

  if (!job.paymentID) {
    throw new Error('missing paymentID')
  }

  if (!job.orderID) {
    throw new Error('missing orderID')
  }

  if (!Number.isInteger(job.seats) || job.seats <= 0) {
  throw new Error('seats must be a positive integer')
  } 

  if (!job.paymentInfo?.cc || typeof job.paymentInfo.cc !== 'string') {
    throw new Error('missing or invalid cc')
  }

  if (job.paymentInfo.cc.length < 15 || job.paymentInfo.cc.length > 16) {
    throw new Error('cc must be a 15-16 digit string')
  }

  if (!/^\d{15,16}$/.test(job.paymentInfo.cc)) {
    throw new Error('cc must contain only digits')
  }

  if (!job.paymentInfo.cardType || !['Visa', 'Amex', 'Master'].includes(job.paymentInfo.cardType)) {
    throw new Error('invalid cardType')
  }

  if (job.price == null || Number.isNaN(Number(job.price))) {
    throw new Error('missing or invalid price')
  }

  if (Number(job.price) < 0) {
    throw new Error('price cannot be negative')
  }
}

function isRetryableError(err) {
  if (!err) return false

  const msg = String(err.message || '').toLowerCase()

  if (
    msg.includes('missing') ||
    msg.includes('invalid') ||
    msg.includes('must be') ||
    msg.includes('cannot be') ||
    msg.includes('cc must')
  ) {
    return false
  }

  return true
}

async function determineFraud(job) {
  const price = Number(job.price)
  const seatCount = job.seats
  const cardLast4 = getCardLast4(job.paymentInfo.cc)

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

async function callRefundService(job, decision) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REFUND_TIMEOUT_MS)

  try {
    const response = await fetch(`REFUND_URL}/refund`, {
      method: 'POST',
      headers: { 'Conetent-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        purchaseID: job.orderID,
        seats: job.seats,
        idemKey: `fraud-refund-${job.paymentID}`,
        reason: decision.reason,
      })
    })

    const body = await response.json().catch(() => ({}))

    if (!response.ok) {
      throw new Error(`refund failed with status ${response.status}: ${body.message ?? 'unknown refund error'}`)
    }

    return body
  } finally {
    clearTimeout(timeout)
  }
}

async function processJob(job){
  validateJob(job)

  console.log(
    '[fraud-worker] received fraud-check event',
    JSON.stringify({
      paymentID: job.paymentID,
      orderID: job.orderID,
      event_id: job.eventID,
      seatCount: job.seats,
      cardType: job.paymentInfo.cardType,
      price: Number(job.price),
      cardLast4: getCardLast4(job.paymentInfo.cc),
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
}

async function processJobWithRetry(job) {
  let attempt = 0

  while (attempt <= PROCESSING_MAX_RETRIES) {
    try {
      await processJob(job)
      return
    } catch (err) {
      const retryable = isRetryableError(err)

      if (!retryable || attempt === PROCESSING_MAX_RETRIES) {
        throw err
      }

      const delay = PROCESSING_BACKOFF_MS * Math.pow(2, attempt)

      console.warn('[fraud-worker] transient failure, retrying',
        JSON.stringify({
          paymentID: job?.paymentID,
          orderID: job?.orderID,
          attempt: attempt + 1,
          maxRetries: PROCESSING_MAX_RETRIES,
          delay_ms: delay,
          error: err.message,
        })
      )

      await sleep(delay)
      attempt++
    }
  }
}

async function saveFraudResult(job, result) {
  const cardLast4 = getCardLast4(job.paymentInfo.cc)

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
      job.eventID,
      job.seats,
      JSON.stringify({ seatCount: job.seats }),
      job.paymentInfo.cardType,
      cardLast4,
      Number(job.price),
      result.flagged,
      result.reason,
      JSON.stringify({
        event_id: job.eventID,
        seatCount: job.seats,
        cardType: job.paymentInfo.cardType,
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
    event_id: job.eventID,
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

      if (!result?.element) {
        continue
      }

      let job

      try {
        job = JSON.parse(result.element)
      } catch (err) {
        console.error('[fraud-worker] invalid JSON, moving to DLQ')

        await redis.rPush(
          DLQ_NAME,
          JSON.stringify({
            originalPayload: result.element,
            error: 'invalid JSON',
            failedAt: new Date().toISOString(),
          })
        )

        continue
      }

      try {
        await processJobWithRetry(job)
      } catch (err) {
        console.error(
          '[fraud-worker] failed processing job after retries, moving to DLQ:',
          err.message
        )

        await redis.rPush(
          DLQ_NAME,
          JSON.stringify({
            originalJob: {
              paymentID: job?.paymentID,
              orderID: job?.orderID,
              event_id: job?.eventID,
            },
            error: err.message,
            failedAt: new Date().toISOString(),
            retriesAttempted: PROCESSING_MAX_RETRIES,
          })
        )
      }
    } catch (err) {
      console.error('[fraud-worker] loop error', err.message)

      await sleep(1000)
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