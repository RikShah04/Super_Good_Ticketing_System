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
const TTL_MIN = process.env.TTL_MIN ? parseInt(process.env.TTL_MIN) : 10;


const app = express();
app.use(express.json());

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
  const markFailed = async (id, reason) => {
    await db.query(
      'UPDATE ticket_purchases SET status = $2, reason = $3 WHERE id = $1',
      [id, 'failed', reason]
    );
  };

  const { eventId, seats, paymentInfo, idemKey } = req.body;
  const { cc, cvv, expiry, cardType } = paymentInfo;
  console.log('Received purchase request, querying event-catalog for seat availability');

  // claim job for idempotency
  const claimed = await client.set(`purchase-idem:${idemKey}`, '1', { NX: true, EX: TTL_MIN * 60 });
  if (!claimed) {
    const jobState = await client.hGet(`purchase-data:${idemKey}`, 'state');

    if (jobState === 'processing') {
      console.log(`Job with idempotency key ${idemKey} is still processing`);
      return res.status(409).json({ message: 'Duplicate detected; request still processing' });
    }
    else {
      console.log(`Job with idempotency key ${idemKey} already completed with status '${jobState}'`);

      const responseStr = await client.hGet(`purchase-data:${idemKey}`, 'response');
      const response = responseStr ? JSON.parse(responseStr) : {};
      const statusCode = await client.hGet(`purchase-data:${idemKey}`, 'status');
      const status = statusCode ? parseInt(statusCode) : (jobState === 'success' ? 200 : 500);

      return res.status(status).json({ message: `Duplicate detected; previous request completed with status ${jobState}`, response });
    }
  }

  // initialize idempotency key data
  await client.hSet(`purchase-data:${idemKey}`, {
    'state': 'processing',
    'status': '',
    'response': '',
  });

  // start db log
  const dbRow = await db.query(
    `INSERT INTO ticket_purchases (event_id, payment_id, purchased_seats, refundable_seats, charge, status) 
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [eventId, null, seats, seats, null, 'pending']
  );
  const id = dbRow.rows[0].id;

  // queries event-catalog for seat
  const seatRes = await fetch(`${EVENT_CATALOG_URL}/reserve-seats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event_id: eventId, seats }),
  });

  // check seatRes status for errors
  if (seatRes.status == 404) {
    console.error('Event not found');

    await markFailed(id, 'Event not found');
    await client.hSet(`purchase-data:${idemKey}`, {
      'state': 'failed',
      'status': '404',
      'response': JSON.stringify({ message: 'Event not found' }),
    });

    return res.status(404).json({ message: 'Event not found' });
  }
  else if (seatRes.status == 409) {
    console.error('Not enough seats available, pushing job to waitlist queue');

    await markFailed(id, 'Not enough seats available');
    await client.hSet(`purchase-data:${idemKey}`, {
      'state': 'failed',
      'status': '409',
      'response': JSON.stringify({ message: 'Not enough seats available, pushed to waitlist' }),
    });
    
    // push to event-specific waitlist queue
    for (let i = 0; i < seats; i++)
      await client.lPush(`${WAITLIST_QUEUE_NAME}-${eventId}`, JSON.stringify({ eventId, paymentInfo, idemKey }));

    return res.status(409).json({ message: 'Not enough seats available, pushed to waitlist' });
  }
  else if (seatRes.status >= 500) {
    console.error('event-catalog error');
    await markFailed(id, 'Event-catalog service error');
    return res.status(500).json({ message: 'Event-catalog service error' });
  }

  const { message, seatCost, totalCost, seatsReserved } = await seatRes.json();
  const price = parseFloat(seatCost);
  console.log('Seat reserved');

  // update db log with price
  await db.query(
    'UPDATE ticket_purchases SET charge = $2 WHERE id = $1',
    [id, price]
  );

  let retries = 0;
  
  // query payments for purchase, with retries
  while (retries < RETRIES) {
    console.log('Querying payment service for purchase confirmation');

    // TODO: send previously generated payment_id on retry
    // currently creates a new id even on retries
    const paymentRes = await fetch(`${PAYMENT_URL}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cc, cvv, expiry, cardType, price }),
    });
    const paymentData = await paymentRes.json();

    // update db log with payment id
    await db.query(
      'UPDATE ticket_purchases SET payment_id = $2 WHERE id = $1',
      [id, paymentData.paymentID]
    );

    // on successful payments...
    if (paymentRes.ok) {
      // update db log with status (success)
      await db.query(
        'UPDATE ticket_purchases SET status = $2 WHERE id = $1',
        [id, 'success']
      );

      console.log('Pushing fraud, analytics, notification jobs to respective queues');
      await client.lPush(
        FRAUD_QUEUE_NAME,
        JSON.stringify({
          eventID: eventId,
          paymentID: paymentData.paymentID,
          orderID: id,
          paymentInfo: { cc, cardType },
          seats,
          refundableSeats: seats,
          price
        })
      );

      await client.lPush(
        ANALYTICS_QUEUE_NAME,
        JSON.stringify({
          schemaVersion: 1,
          eventType: 'purchase',
          idemKey,
          sourceService: SERVICE_NAME,
          emittedAt: new Date().toISOString(),
          eventId,
          orderId: id,
          paymentId: paymentData.paymentID,
          seats,
          refundableSeats: seats,
          priceUsd: price,
        })
      );

      await client.publish(
        NOTIFICATION_PUBSUB_NAME,
        JSON.stringify({
          eventId,
          paymentId: paymentData.paymentID,
          orderId: id,
          type: 'purchase',
          seats,
          refundableSeats: seats,
          cc,
          cardType,
          price,
        })
      );

      // update idempotency key with response
      await client.hSet(`purchase-data:${idemKey}`, {
        'state': 'success',
        'status': '200',
        'response': JSON.stringify({ message: 'Purchase successful' })
      });

      console.log('Payment successful');
      return res.status(200).json({ message: 'Purchase successful', purchaseId: id });
    }

    // on failures...
    else {
      // on client errors, fail
      if (paymentRes.status === 400) {
        console.error('Invalid payment data');

        await markFailed(id, 'Invalid payment data');
        await client.hSet(`purchase-data:${idemKey}`, {
          'state': 'failed',
          'status': '400',
          'response': JSON.stringify({ message: 'Invalid payment data' }),
        });

        return res.status(400).json({ message: 'Invalid payment data' });
      }

      // on server errors, retry
      else if (paymentRes.status >= 500) {
        console.error(`Payment service error: ${paymentData.error}`);

        // for persistent payment failures, queries event-catalog to unreserve seat and ends
        if (retries >= RETRIES) {
          await markFailed(id, 'Payment service error after retries');
          await client.hSet(`purchase-data:${idemKey}`, {
            'state': 'failed',
            'status': '500',
            'response': JSON.stringify({ message: 'Payment service error after retries' }),
          });

          // await fetch(`${EVENT_CATALOG_URL}/unreserve-seats`, {
          //   method: 'POST',
          //   headers: { 'Content-Type': 'application/json' },
          //   body: JSON.stringify({ eventId, seats }),
          // });
          // console.log('Payment failed after retries, unreserved seats and will promote waitlist job');

          // TODO: message waitlist to promote job

          return res.status(500).json({ message: 'Payment service error after retries' });
        }

        console.log(`Retrying (${retries}/${RETRIES})`);
        retries++;
      }
    }
  }
});

app.post('/verify', async (req, res) => {
  const { purchaseId, seats } = req.body;
  
  const dbRes = await db.query(
    'SELECT * FROM ticket_purchases WHERE id = $1',
    [purchaseId]
  );

  if (dbRes.rows.length === 0)
    return res.status(404).json({ message: 'Purchase not found' });
  const purchase = dbRes.rows[0];

  if (purchase.refundable_seats < seats)
    return res.status(400).json({ message: 'Not enough refundable seats available' });

  // cache refund in Redis for /refund to confirm
  // if too much time has passed, the refund will cancel
  await client.set(`ticket-purchase-refund:${purchaseId}`, seats, { EX: TTL_MIN * 60 });

  res.status(200).json({ ...purchase });
});

app.post('/refund', async (req, res) => {
  const { purchaseId } = req.body;

  const refundableSeats = await client.get(`ticket-purchase-refund:${purchaseId}`);
  if (!refundableSeats)
    return res.status(400).json({ message: 'Refund request expired or invalid' });
  
  const seatsInt = parseInt(refundableSeats);

  // perform refund
  await db.query(
    'UPDATE ticket_purchases SET refundable_seats = refundable_seats - $2 WHERE id = $1',
    [purchaseId, refundableSeats]
  );
  await client.del(`ticket-purchase-refund:${purchaseId}`);

  res.status(200).json({ message: 'Refund successful', refundedSeats: seatsInt });
});


app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
