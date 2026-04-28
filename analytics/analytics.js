import express from 'express';
import { createClient } from 'redis';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

const { Pool } = pg;

const app = express();
const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();
// Keep a dedicated client for block`ing BRPOP so health/LLEN checks stay responsive.
const workerRedis = createClient({ url: process.env.REDIS_URL });
await workerRedis.connect();
const db = new Pool({ connectionString: process.env.DATABASE_URL });

const PURCHASE_QUEUE_NAME = process.env.PURCHASE_QUEUE_NAME ?? 'analytics:purchase:queue';
const BROWSE_QUEUE_NAME = process.env.BROWSE_QUEUE_NAME ?? 'analytics:browse:queue';
const REFUND_QUEUE_NAME = process.env.REFUND_QUEUE_NAME ?? 'analytics:refund:queue';
const DLQ_NAME = process.env.DLQ_NAME ?? `analytics:dlq`;
const ALLOWED_TYPES = new Set(['purchase', 'event.viewed', 'refund']);

const startTime = Date.now();
let lastJobAt = null;
let jobsProcessed = 0;


export function recordJobProcessed() {
  lastJobAt = new Date().toISOString();
  jobsProcessed++;
}

// Load and run the worker schema from disk so SQL stays in schema.sql.
async function ensureSchema() {
  const schemaPath = new URL('./db/schema.sql', import.meta.url);
  const sql = await readFile(schemaPath, 'utf8');

  if (!sql.trim()) {
    throw new Error('analytics/db/schema.sql is empty');
  }

  await db.query(sql);
}

// Validate and normalize inbound queue messages before any writes.
function validateEvent(job) {
  if (!job || typeof job !== 'object') {
    throw new Error('event payload must be an object');
  }

  const { idemKey, eventType, sourceService, eventId, emittedAt } = job;
  if (!idemKey || !eventType || !sourceService || !eventId || !emittedAt) {
    throw new Error('missing required envelope fields: idemKey, eventType, sourceService, eventId, emittedAt');
  }

  if (!ALLOWED_TYPES.has(eventType)) {
    throw new Error(`unsupported eventType: ${eventType}`);
  }

  const normalizedIdemKey = String(idemKey).trim();
  if (!normalizedIdemKey) throw new Error('idemKey must be a non-empty string');

  const userId = job.userId ? String(job.userId) : null;

  switch (eventType) {
    case 'purchase': {
      if (!job.orderId) throw new Error('purchase event missing orderId');
      const seats = Number(job.seats);
      const priceUsd = Number(job.priceUsd);
      if (!Number.isFinite(seats) || seats <= 0) throw new Error(`invalid seats: ${job.seats}`);
      if (!Number.isFinite(priceUsd) || priceUsd < 0) throw new Error(`invalid priceUsd: ${job.priceUsd}`);
      return {
        kind: 'purchase',
        idemKey: normalizedIdemKey,
        eventType,
        sourceService: String(sourceService),
        eventId: String(eventId),
        userId,
        orderId: Number(job.orderId),
        paymentId: job.paymentId ? String(job.paymentId) : null,
        seats,
        priceUsd,
        emittedAt: String(emittedAt),
        payload: job,
      };
    }
    case 'event.viewed': {
      const seats = job.seats != null ? Number(job.seats) : null;
      const priceUsd = job.priceUsd != null ? Number(job.priceUsd) : null;
      if (seats !== null && (!Number.isFinite(seats) || seats < 0)) throw new Error(`invalid seats: ${job.seats}`);
      if (priceUsd !== null && (!Number.isFinite(priceUsd) || priceUsd < 0)) throw new Error(`invalid priceUsd: ${job.priceUsd}`);
      return {
        kind: 'browse',
        idemKey: normalizedIdemKey,
        eventType,
        sourceService: String(sourceService),
        eventId: String(eventId),
        userId,
        orderId: null,
        paymentId: null,
        seats,
        priceUsd,
        emittedAt: String(emittedAt),
        payload: job,
      };
    }
    case 'refund': {
      const seats = Number(job.seats);
      const priceUsd = Number(job.priceUsd);
      if (!Number.isFinite(seats) || seats <= 0) throw new Error(`invalid seats: ${job.seats}`);
      if (!Number.isFinite(priceUsd) || priceUsd < 0) throw new Error(`invalid priceUsd: ${job.priceUsd}`);
      return {
        kind: 'refund',
        idemKey: normalizedIdemKey,
        eventType,
        sourceService: String(sourceService),
        eventId: String(eventId),
        userId,
        orderId: null,
        paymentId: job.payload?.paymentId ? String(job.payload.paymentId) : null,
        seats,
        priceUsd,
        emittedAt: String(emittedAt),
        payload: job.payload ?? {},
      };
    }
    default:
      throw new Error(`unsupported eventType: ${eventType}`);
  }
}

async function processBrowseEvent(event) {
  const inserted = await db.query(
    `INSERT INTO analytics_events
      (idem_key, event_type, source_service, event_id, order_id, payment_id, user_id, seats, price_usd, emitted_at, payload)
     VALUES
      ($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (idem_key) DO NOTHING
     RETURNING idem_key`,
    [
      event.idemKey,
      event.eventType,
      event.sourceService,
      event.eventId,
      event.userId,
      event.seats,
      event.priceUsd,
      event.emittedAt,
      JSON.stringify(event.payload),
    ]
  );

  if (inserted.rowCount === 0) {
    console.log(`[analytics-worker] duplicate browse ignored ${event.idemKey}`);
    recordJobProcessed('browse');
    return;
  }

  await db.query(
    `INSERT INTO event_view_aggregates (event_id, view_count, last_viewed_at)
     VALUES ($1, 1, NOW())
     ON CONFLICT (event_id)
     DO UPDATE SET
       view_count = event_view_aggregates.view_count + 1,
       last_viewed_at = NOW()`,
    [event.eventId]
  );

  console.log(`[analytics-worker] processed browse ${event.idemKey}`);
  recordJobProcessed('browse');
}

async function processPurchaseEvent(event) {
  const inserted = await db.query(
    `INSERT INTO analytics_events
      (idem_key, event_type, source_service, event_id, order_id, payment_id, user_id, seats, price_usd, emitted_at, payload)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (idem_key) DO NOTHING
     RETURNING idem_key`,
    [
      event.idemKey,
      event.eventType,
      event.sourceService,
      event.eventId,
      event.orderId,
      event.paymentId,
      event.userId,
      event.seats,
      event.priceUsd,
      event.emittedAt,
      JSON.stringify(event.payload),
    ]
  );

  if (inserted.rowCount === 0) {
    console.log(`[analytics-worker] duplicate purchase ignored ${event.idemKey}`);
    recordJobProcessed('purchase');
    return;
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
  );

  console.log(`[analytics-worker] processed purchase ${event.idemKey}`);
  recordJobProcessed('purchase');
}

async function processRefundEvent(event) {
  const inserted = await db.query(
    `INSERT INTO analytics_events
      (idem_key, event_type, source_service, event_id, order_id, payment_id, user_id, seats, price_usd, emitted_at, payload)
     VALUES
      ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (idem_key) DO NOTHING
     RETURNING idem_key`,
    [
      event.idemKey,
      event.eventType,
      event.sourceService,
      event.eventId,
      event.paymentId,
      event.userId,
      event.seats,
      event.priceUsd,
      event.emittedAt,
      JSON.stringify(event.payload),
    ]
  );

  if (inserted.rowCount === 0) {
    console.log(`[analytics-worker] duplicate refund ignored ${event.idemKey}`);
    recordJobProcessed('refund');
    return;
  }

  await db.query(
    `INSERT INTO event_sales_aggregates
      (event_id, tickets_sold, gross_revenue, purchase_events, tickets_refunded, refunded_revenue, refund_events, updated_at)
     VALUES ($1, 0, 0, 0, $2, $3, 1, NOW())
     ON CONFLICT (event_id)
     DO UPDATE SET
       tickets_refunded = event_sales_aggregates.tickets_refunded + EXCLUDED.tickets_refunded,
       refunded_revenue = event_sales_aggregates.refunded_revenue + EXCLUDED.refunded_revenue,
       refund_events    = event_sales_aggregates.refund_events + 1,
       updated_at       = NOW()`,
    [event.eventId, event.seats, event.priceUsd]
  );

  console.log(`[analytics-worker] processed refund ${event.idemKey}`);
  recordJobProcessed('refund');
}

// Main consumer loop: block on queue, process valid jobs, DLQ invalid ones.
async function mainAnalyticsLoop() {
  while (true) {
    const result = await workerRedis.brPop(PURCHASE_QUEUE_NAME, 0);
    if (!result?.element) continue;

    try {
      const parsed = JSON.parse(result.element);
      const event = validatePurchaseEvent(parsed);
      await processPurchaseEvent(event);
    } catch (err) {
      console.error(`[analytics-worker] bad job (${err.message}): ${result.element}`);

      // Extra careful try catch within DLQ write
      try {
        await redis.lPush(DLQ_NAME, result.element);
        console.error(`[analytics-worker] moved bad job to DLQ`);
      } catch (dlqErr) {
        console.error(`[analytics-worker] FAILED to write to DLQ: ${dlqErr.message}`);
      }
    }
  }
}

app.get('/health', async (req, res) => {
  const checks = {};
  let healthy = true;

  // Check DB
  const dbStart = Date.now();
  try {
    await db.query('SELECT 1');
    checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart };
  } catch (err) {
    checks.database = { status: 'unhealthy', error: err.message };
    healthy = false;
  }

  // Check Redis
  const redisStart = Date.now();
  try {
    const pong = await redis.ping();
    if (pong !== 'PONG') throw new Error(`unexpected response: ${pong}`);
    checks.redis = { status: 'healthy', latency_ms: Date.now() - redisStart };
  } catch (err) {
    checks.redis = { status: 'unhealthy', error: err.message };
    healthy = false;
  }

  // Check queue depth — flag if backlog is growing
  try {
    const depth = await redis.lLen(PURCHASE_QUEUE_NAME);
    const dlqDepth = await redis.lLen(DLQ_NAME);
    checks.queue = {
      status: depth < 1000 && dlqDepth === 0 ? 'healthy' : 'degraded',
      depth,
      dlq_depth: dlqDepth,
    };
  } catch (err) {
    checks.queue = { status: 'unhealthy', error: err.message };
    healthy = false;
  }

  // Check that the worker is actually processing jobs
  const secondsSinceLastJob = lastJobAt
    ? (Date.now() - new Date(lastJobAt).getTime()) / 1000
    : null;
  checks.worker = {
    status:
      secondsSinceLastJob === null || secondsSinceLastJob < 60
        ? 'healthy'
        : 'degraded',
    last_job_at: lastJobAt ?? 'never',
    jobs_processed: jobsProcessed,
    seconds_since_last_job: secondsSinceLastJob,
  };

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: process.env.SERVICE_NAME ?? 'analytics-worker',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  });
})

await ensureSchema();

app.listen(process.env.PORT ?? 3000, () => {
  console.log(`[analytics-worker] listening on ${process.env.PORT ?? 3000}`);
})

mainAnalyticsLoop().catch(err => {
  console.error('[analytics-worker] worker loop crashed', err);
  process.exit(1);
})