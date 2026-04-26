import express from 'express';
import redis from 'redis';


const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const SERVICE_NAME = process.env.SERVICE_NAME || 'waitlist-worker';
const QUEUE_NAME = process.env.QUEUE_NAME || 'waitlist-jobs';
const DLQ_NAME = process.env.DLQ_NAME || `${QUEUE_NAME}:dlq`;
const PAYMENT_URL = process.env.PAYMENT_URL || "http://payment:3001"
const TICKET_PURCHASE_URL = process.env.TICKET_PURCHASE_URL || "http://ticket-purchase:3000"

const app = express();

const client = redis.createClient({ url: REDIS_URL });
client.on('error', (err) => {
  console.error('Redis error:', err);
});
await client.connect();


const startTime = Date.now();
let lastJobAt = null;
let jobsProcessed = 0;

// Your worker loop sets these as it runs
export function recordJobProcessed() {
  lastJobAt = new Date().toISOString();
  jobsProcessed++;
}

app.get('/health', async (req, res) => {
  const checks = {};
  let healthy = true;

  // Check Redis
  const redisStart = Date.now();
  try {
    await client.ping();
    checks.redis = { status: 'healthy', latency_ms: Date.now() - redisStart };
  } catch (err) {
    checks.redis = { status: 'unhealthy', error: err.message };
    healthy = false;
  }

  // Check queue depth — flag if backlog is growing
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

  // Check that the worker is actually processing jobs
  const secondsSinceLastJob = lastJobAt
    ? (Date.now() - new Date(lastJobAt).getTime()) / 1000
    : null;
  
  checks.worker = {
    status: secondsSinceLastJob === null || secondsSinceLastJob < 60
      ? 'healthy'
      : 'degraded',
    last_job_at: lastJobAt ?? 'never',
    jobs_processed: jobsProcessed,
    seconds_since_last_job: secondsSinceLastJob,
  };

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  });
});

async function processJob(event_id){
  let event_queue = QUEUE_NAME + "-" + event_id
  let waitlist_item = await client.LPOP(event_queue)
  

  const response = await fetch(TICKET_PURCHASE_URL + '/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(waitlist_item),
  })
  
  let data = await response.json();
  console.log(`Event ${event_id}: status=${response.status}`, data);
  return data;
}

async function loop(){
  while(true){
    const result = await client.brPop(QUEUE_NAME, 0)
    const raw = result?.element
    if (!raw) continue

    try{
      await processJob(JSON.parse(raw))
    } catch (err) {
      console.error('Invalid job payload:', err.message)
    }

  }
}


app.listen(3000, () => {
  console.log('Worker is running on port 3000');
});

await loop();
