import express from 'express';
import redis from 'redis';
import pg from 'pg';


const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@ticket-purchase-db:5432/ticket-purchase-db';
const SERVICE_NAME = process.env.SERVICE_NAME || 'ticket-purchase';
const FRAUD_QUEUE_NAME = process.env.FRAUD_QUEUE_NAME || 'fraud:queue';
const ANALYTICS_QUEUE_NAME = process.env.ANALYTICS_QUEUE_NAME || 'analytics:queue';
const WAITLIST_QUEUE_NAME = process.env.WAITLIST_QUEUE_NAME || 'waitlist:queue';
const NOTIFICATION_PUBSUB_NAME = process.env.NOTIFICATION_PUBSUB_NAME || 'notification:pubsub';
const EVENT_CATALOG_URL = process.env.EVENT_CATALOG_URL || 'http://event-catalog:3005';
const PAYMENT_URL = process.env.PAYMENT_URL || 'http://payment:3001';

const RETRIES = process.env.RETRIES ? parseInt(process.env.RETRIES) : 3;


const app = express();

const client = redis.createClient({ url: REDIS_URL });
client.on('error', (err) => {
  console.error('Redis error:', err);
});
await client.connect();

const db = new pg.Pool({ connectionString: DATABASE_URL });
db.on('error', (err) => {
  console.error('Postgres error:', err);
});

const startTime = Date.now()


app.get('/health', async (req, res) => {
  const checks = {};
  let healthy = true;

  // Check PostgreSQL
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
    const pong = await client.ping();
    if (pong !== 'PONG') throw new Error(`unexpected response: ${pong}`);

    checks.redis = { status: 'healthy', latency_ms: Date.now() - redisStart };
  } catch (err) {
    checks.redis = { status: 'unhealthy', error: err.message };
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

app.post('/purchase', async (req, res) => {
  const { eventId, seats, paymentInfo } = req.body;
  console.log('Received purchase request, querying event-catalog for seat availability');

  // queries event-catalog for seat
  const seatRes = await fetch(`${EVENT_CATALOG_URL}/reserve-seats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId, seats }),
  });

  // check seatRes status for errors
  if (seatRes.status == 404) {
    console.error('Event not found');
    res.status(404).json({ message: 'Event not found' });
  }
  else if (seatRes.status == 409) {
    console.error('Not enough seats available, pushing job to waitlist queue');
    client.lpush(WAITLIST_QUEUE_NAME, JSON.stringify({ eventId, seats, paymentInfo }));
    res.status(409).json({ message: 'Not enough seats available' });
  }
  else if (seatRes.status >= 500) {
    console.error('event-catalog error');
    res.status(500).json({ message: 'Unexpected error occured' });
  }

  const { message, cost, seatsReserved } = await seatRes.json();
  const price = parseFloat(cost);

  // let success = false;
  // let retries = 0;
  
  // // query payments for purchase, with retries
  // while (!success && retries < RETRIES) {
  //   console.log('Querying payment service for purchase confirmation');

  //   const paymentRes = await fetch(`${PAYMENT_URL}/process`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ paymentInfo, amount: seatData.price }),
  //   });
  //   const paymentData = await paymentRes.json();

  //   if (!paymentData.success) {
  //     retries++;
  //     console.log(`Payment failed, retrying (${retries}/${RETRIES}); reason: ${paymentData.error}`);
  //     continue;
  //   }

  //   success = true;
  // }

  // // for persistent payment failures, queries event-catalog to unreserve seat
  // // TODO: message waitlist to promote job
  // if (!success) {
  //   await fetch(`${EVENT_CATALOG_URL}/unreserve-seats`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ eventId, seats }),
  //   });
  //   console.log('Payment failed after retries, unreserved seats and will promote waitlist job');
  // }
  // // TODO: save purchase attempt to db

  // // TODO: push job to fraud, notification, analytics channels
  // client.lpush(FRAUD_QUEUE_NAME, JSON.stringify({}));
  // client.lpush(ANALYTICS_QUEUE_NAME, JSON.stringify({}));
  // client.publish(NOTIFICATION_PUBSUB_NAME, JSON.stringify({}));
  // console.log('Pushed fraud, analytics, notification jobs to respective queues');
});


app.listen(3000, () => {
  console.log('Server is running on port 3000');
});

// app.get('/available_events', async (req, res) => {
//   const response = await fetch(`${EVENT_CATALOG_URL}/events`);
//   const events = await response.json();
//   res.json(events);
// });
