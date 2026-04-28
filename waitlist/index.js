import express from 'express';
import redis from 'redis';
import { randomUUID } from 'crypto';

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const SERVICE_NAME = process.env.SERVICE_NAME || 'waitlist-worker';
const QUEUE_NAME = process.env.QUEUE_NAME || 'waitlist-jobs';
const PAYMENT_URL = process.env.PAYMENT_URL || 'http://payment:3001';
const TICKET_PURCHASE_URL = process.env.TICKET_PURCHASE_URL || 'http://ticket-purchase:3000';

const PIPELINE = process.env.PIPELINE || 'waitlist';
const MODE = process.env.MODE || 'idem';

const minMs = Number(process.env.WORK_SIM_MIN_MS || 200);
const maxMs = Number(process.env.WORK_SIM_MAX_MS || 700);
const ttlSec = Number(process.env.IDEM_TTL_SEC || 86400);
const maxRetries = Number(process.env.MAX_RETRIES || 3);
const retryBaseMs = Number(process.env.RETRY_BASE_MS || 500);

const DLQ_NAME = process.env.DLQ_NAME || `${QUEUE_NAME}:dlq`;

const config = {
  redisUrl: REDIS_URL,
  queueName: QUEUE_NAME,
  pipeline: PIPELINE,
  mode: MODE,
  minMs,
  maxMs,
  ttlSec,
  maxRetries,
  retryBaseMs,
  dlqName: DLQ_NAME,
};

const app = express();

const client = redis.createClient({ url: config.redisUrl });
client.on('error', (err) => {
  console.error('Redis error:', err.message);
});
await client.connect();

const startTime = Date.now();

const keys = {
  job: (jobId) => `job:${config.pipeline}:${jobId}`,
  processed: (jobId) => `processed:${config.pipeline}:${jobId}`,
  dlqTotal: () => `dlq-total:${config.pipeline}`,
};

const JobStatus = (status, fields = {}) => ({
  status,
  updatedAt: new Date().toISOString(),
  ...fields,
});

const DLQEntry = (job, reason) => ({
  ...job,
  dlqReason: reason,
  dlqAt: new Date().toISOString(),
  pipeline: config.pipeline,
});

const RetryJob = (job, attempt) => ({ ...job, retryAttempt: attempt });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sendToDlq = async (job, reason) => {
  await client.lPush(config.dlqName, JSON.stringify(DLQEntry(job, reason)));
  await client.incr(keys.dlqTotal());
  await client.expire(keys.dlqTotal(), config.ttlSec);

  await client.hSet(
    keys.job(job.jobId),
    JobStatus('dead-lettered', { dlqReason: reason }),
  );

  console.log(
    `pipeline=${config.pipeline} mode=${config.mode} job=${job.jobId} status=dead-lettered reason="${reason}"`,
  );
};

const scheduleRetry = async (job, attempt, errorMsg) => {
  const backoffMs = config.retryBaseMs * Math.pow(2, attempt - 1);

  await client.hSet(
    keys.job(job.jobId),
    JobStatus('retrying', {
      retryAttempt: String(attempt),
      lastError: errorMsg,
    }),
  );

  console.log(
    `pipeline=${config.pipeline} mode=${config.mode} job=${job.jobId} status=retrying ` +
      `attempt=${attempt} backoffMs=${backoffMs} error="${errorMsg}"`,
  );

  await sleep(backoffMs);
  await client.lPush(config.queueName, JSON.stringify(RetryJob(job, attempt)));
};

function processedKey(idemKey) {
  return `processed:${idemKey}`;
}

async function processJob(job) {
  const attempt = job.retryAttempt ?? 0;
  const event_id = job.eventId;

  await client.hSet(
    keys.job(job.jobId),
    JobStatus('processing', {
      pipeline: config.pipeline,
      mode: config.mode,
    }),
  );
  await client.hIncrBy(keys.job(job.jobId), 'processAttempts', 1);
  await client.expire(keys.job(job.jobId), config.ttlSec);

  if (config.mode === 'idem') {
    const claimedJob = await client.set(keys.processed(job.jobId), '1', {
      NX: true,
      EX: config.ttlSec,
    });

    if (!claimedJob) {
      await client.hSet(
        keys.job(job.jobId),
        JobStatus('duplicate-skipped', { idempotency: 'skipped' }),
      );
      await client.hIncrBy(keys.job(job.jobId), 'duplicateSkips', 1);
      console.log(
        `pipeline=${config.pipeline} mode=${config.mode} job=${job.jobId} duplicate-skipped (job idem)`,
      );
      return;
    }
  }

  try {
    let event_queue = QUEUE_NAME + '-' + event_id;
    let waitlist_item = await client.lPop(event_queue);

    if (!waitlist_item) {
      await client.hSet(
        keys.job(job.jobId),
        JobStatus('done', {
          skipped: 'true',
          reason: 'empty_per_event_queue',
        }),
      );
      console.log(
        `pipeline=${config.pipeline} job=${job.jobId} status=done skipped (empty per-event queue)`,
      );
      return;
    }

    const { eventId, paymentInfo, idemKey } = JSON.parse(waitlist_item);
    const seats = 1;

    const key = processedKey(idemKey);
    const claimed = await client.set(key, '1', {
      NX: true,
      EX: config.ttlSec,
    });
    if (!claimed) {
      await client.hSet(
        keys.job(job.jobId),
        JobStatus('done', {
          skipped: 'true',
          reason: 'duplicate_purchase_idemKey',
        }),
      );
      console.log(
        `pipeline=${config.pipeline} job=${job.jobId} status=done skipped (duplicate idemKey)`,
      );
      return;
    }

    try {
      const response = await fetch(`${TICKET_PURCHASE_URL}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, seats, paymentInfo, idemKey }),
      });

      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { raw: text };
      }

      if (!response.ok) {
        await client.del(key);
        throw new Error(`purchase HTTP ${response.status}: ${text.slice(0, 200)}`);
      }

      console.log(`Event ${event_id}: status=${response.status}`, data);

      const doneAt = new Date().toISOString();
      await client.hSet(
        keys.job(job.jobId),
        JobStatus('done', {
          updatedAt: doneAt,
          finishedAt: doneAt,
          idempotency: config.mode === 'idem' ? 'applied' : 'none',
        }),
      );

      console.log(
        `pipeline=${config.pipeline} mode=${config.mode} job=${job.jobId} status=done`,
      );
    } catch (err) {
      await client.del(key);
      throw err;
    }
  } catch (err) {
    const nextAttempt = attempt + 1;

    if (nextAttempt > config.maxRetries) {
      await sendToDlq(job, err.message);
    } else {
      await scheduleRetry(job, nextAttempt, err.message);
    }
  }
}

const loop = async () => {
  while (true) {
    const result = await client.brPop(config.queueName, 0);
    const raw = result?.element;
    if (!raw) continue;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('Invalid job payload (not JSON):', raw.slice(0, 200));
      continue;
    }

    let job;
    if (typeof parsed === 'string') {
      job = { jobId: randomUUID(), eventId: parsed };
    } else if (parsed?.eventId) {
      job = {
        ...parsed,
        jobId: parsed.jobId ?? randomUUID(),
        eventId: String(parsed.eventId),
      };
    } else {
      console.error('Invalid job payload (need JSON string event id or retry job object)');
      continue;
    }

    try {
      await processJob(job);
    } catch (err) {
      await client.hSet(
        keys.job(job.jobId),
        JobStatus('failed', { error: err.message }),
      );
      console.error(
        `pipeline=${config.pipeline} job=${job.jobId} status=failed error=${err.message}`,
      );
    }
  }
};

app.get('/health', async (req, res) => {
  const checks = {};
  let healthy = true;

  const redisStart = Date.now();
  try {
    await client.ping();
    checks.redis = { status: 'healthy', latency_ms: Date.now() - redisStart };
  } catch (err) {
    checks.redis = { status: 'unhealthy', error: err.message };
    healthy = false;
  }

  try {
    const queueDepth = await client.lLen(QUEUE_NAME);
    const dlqDepth = await client.lLen(DLQ_NAME);

    checks.queue = {
      status: queueDepth < 1000 ? 'healthy' : 'degraded',
      depth: queueDepth,
      dlq_depth: dlqDepth,
    };

    if (dlqDepth > 0) checks.queue.status = 'degraded';
  } catch (err) {
    checks.queue = { status: 'unhealthy', error: err.message };
    healthy = false;
  }

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  });
});

app.listen(3000, () => {
  console.log(
    `Worker connected pipeline=${config.pipeline} mode=${config.mode} ` +
      `queue=${config.queueName} dlq=${config.dlqName} maxRetries=${config.maxRetries}`,
  );
  console.log('Waitlist worker HTTP listening on port 3000');
});

await loop();
