import express from 'express';
import { createClient } from 'redis';
import pg from 'pg';
import { readFile } from 'node:fs/promises';

const { Pool } = pg;

const app = express();
const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

// Dedicated blocking clients — one per loop so health/LLEN checks on `redis` stay responsive.
const purchaseWorkerRedis = createClient({ url: process.env.REDIS_URL });
await purchaseWorkerRedis.connect();
const browseWorkerRedis = createClient({ url: process.env.REDIS_URL });
await browseWorkerRedis.connect();
const refundWorkerRedis = createClient({ url: process.env.REDIS_URL });
await refundWorkerRedis.connect();

const db = new Pool({ connectionString: process.env.DATABASE_URL });

const PURCHASE_QUEUE_NAME = process.env.PURCHASE_QUEUE_NAME ?? 'analytics:purchase:queue';
const BROWSE_QUEUE_NAME = process.env.BROWSE_QUEUE_NAME ?? 'analytics:browse:queue';
const REFUND_QUEUE_NAME = process.env.REFUND_QUEUE_NAME ?? 'analytics:refund:queue';
const DLQ_NAME = process.env.DLQ_NAME ?? `analytics:dlq`;
const ALLOWED_TYPES = new Set(['purchase', 'event.viewed', 'refund']);

const startTime = Date.now();
const stats = {
  purchase: { lastJobAt: null, jobsProcessed: 0 },
  browse:   { lastJobAt: null, jobsProcessed: 0 },
  refund:   { lastJobAt: null, jobsProcessed: 0 },
};

export function recordJobProcessed(kind) {
  stats[kind].lastJobAt = new Date().toISOString();
  stats[kind].jobsProcessed++;
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
  // Idempotent insert — gates aggregate updates; DO NOTHING on conflict means duplicates exit early
  const inserted = await db.query(
    `INSERT INTO browse_events
      (idem_key, source_service, event_id, user_id, seats, price_usd, emitted_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
     ON CONFLICT (idem_key) DO NOTHING
     RETURNING idem_key`,
    [
      event.idemKey,
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

  // Increment total view count and timestamp of most recent view
  await db.query(
    `INSERT INTO event_view_aggregates (event_id, view_count, last_viewed_at)
     VALUES ($1, 1, NOW())
     ON CONFLICT (event_id)
     DO UPDATE SET
       view_count = event_view_aggregates.view_count + 1,
       last_viewed_at = NOW()`,
    [event.eventId]
  );

  // Increment view count for the event's hour bucket to track peak browse times
  await db.query(
    `INSERT INTO event_browse_hourly (event_id, hour_bucket, view_count)
     VALUES ($1, date_trunc('hour', $2::timestamptz), 1)
     ON CONFLICT (event_id, hour_bucket)
     DO UPDATE SET view_count = event_browse_hourly.view_count + 1`,
    [event.eventId, event.emittedAt]
  );

  console.log(`[analytics-worker] processed browse ${event.idemKey}`);
  recordJobProcessed('browse');
}

async function processPurchaseEvent(event) {
  // Idempotent insert — gates aggregate updates; DO NOTHING on conflict means duplicates exit early
  const inserted = await db.query(
    `INSERT INTO purchase_events
      (idem_key, source_service, event_id, order_id, payment_id, user_id, seats, price_usd, emitted_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (idem_key) DO NOTHING
     RETURNING idem_key`,
    [
      event.idemKey,
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

  // Accumulate tickets sold and gross revenue per event
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
  // Idempotent insert — gates aggregate updates; DO NOTHING on conflict means duplicates exit early
  const inserted = await db.query(
    `INSERT INTO refund_events
      (idem_key, source_service, event_id, payment_id, user_id, seats, price_usd, emitted_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (idem_key) DO NOTHING
     RETURNING idem_key`,
    [
      event.idemKey,
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

  // Accumulate refunded tickets and revenue per event; ORDER BY tickets_refunded DESC gives most-refunded ranking
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

async function sharedLoopHandler(raw, kind) {
  try {
    const event = validateEvent(JSON.parse(raw));
    if (event.kind !== kind) throw new Error(`eventType ${event.eventType} arrived on ${kind} queue`);
    if (kind === 'purchase')    await processPurchaseEvent(event);
    else if (kind === 'browse') await processBrowseEvent(event);
    else                        await processRefundEvent(event);
  } catch (err) {
    console.error(`[analytics-worker] bad ${kind} job (${err.message}): ${raw}`);
    try { await redis.lPush(DLQ_NAME, raw); }
    catch (dlqErr) { console.error(`[analytics-worker] FAILED DLQ write: ${dlqErr.message}`); }
  }
}

async function purchaseLoop() {
  while (true) {
    const r = await purchaseWorkerRedis.brPop(PURCHASE_QUEUE_NAME, 0);
    if (!r?.element) continue;
    await sharedLoopHandler(r.element, 'purchase');
  }
}

async function browseLoop() {
  while (true) {
    const r = await browseWorkerRedis.brPop(BROWSE_QUEUE_NAME, 0);
    if (!r?.element) continue;
    await sharedLoopHandler(r.element, 'browse');
  }
}

async function refundLoop() {
  while (true) {
    const r = await refundWorkerRedis.brPop(REFUND_QUEUE_NAME, 0);
    if (!r?.element) continue;
    await sharedLoopHandler(r.element, 'refund');
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

  // Check queue depths — flag if any queue is backing up or DLQ is non-empty
  try {
    const [purchaseDepth, browseDepth, refundDepth, dlqDepth] = await Promise.all([
      redis.lLen(PURCHASE_QUEUE_NAME),
      redis.lLen(BROWSE_QUEUE_NAME),
      redis.lLen(REFUND_QUEUE_NAME),
      redis.lLen(DLQ_NAME),
    ]);
    checks.queue = {
      status: purchaseDepth < 1000 && browseDepth < 1000 && refundDepth < 1000 && dlqDepth === 0
        ? 'healthy' : 'degraded',
      purchase_depth: purchaseDepth,
      browse_depth:   browseDepth,
      refund_depth:   refundDepth,
      dlq_depth:      dlqDepth,
    };
    if (checks.queue.status === 'degraded') healthy = false;
  } catch (err) {
    checks.queue = { status: 'unhealthy', error: err.message };
    healthy = false;
  }

  // Per-kind worker stats
  const workerStats = {};
  for (const kind of ['purchase', 'browse', 'refund']) {
    const { lastJobAt, jobsProcessed } = stats[kind];
    const secondsSince = lastJobAt
      ? (Date.now() - new Date(lastJobAt).getTime()) / 1000
      : null;
    workerStats[kind] = {
      status: secondsSince === null || secondsSince < 60 ? 'healthy' : 'degraded',
      last_job_at: lastJobAt ?? 'never',
      jobs_processed: jobsProcessed,
      seconds_since_last_job: secondsSince,
    };
  }
  checks.worker = workerStats;

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

purchaseLoop().catch(err => { console.error('[analytics-worker] purchase loop crashed', err); process.exit(1); });
browseLoop().catch(err   => { console.error('[analytics-worker] browse loop crashed',   err); process.exit(1); });
refundLoop().catch(err   => { console.error('[analytics-worker] refund loop crashed',   err); process.exit(1); });