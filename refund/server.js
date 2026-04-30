import express from "express";
import redis from "redis";
import pg from "pg";
import validator from "validator";

const app = express();
app.use(express.json());

// Getting userId for push to analytics
app.use((req, _res, next) => {
  const userId = req.header("x-user-id");
  req.user = (userId && validator.isUUID(userId)) ? { id: userId } : null;
  next();
});

const port = process.env.PORT || 3000;
const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
const SERVICE_NAME = process.env.SERVICE_NAME || 'refund';
const DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@refund-db:5432/refund_db";

const EVENT_CATALOG_URL = process.env.EVENT_CATALOG_URL || 'http://event-catalog:3005';
const PAYMENT_URL = process.env.PAYMENT_URL || 'http://payment:3001';
const TICKET_PURCHASE_URL = process.env.TICKET_PURCHASE_URL || "http://ticket-purchase:3000";

const ANALYTICS_RQUEUE_NAME = process.env.ANALYTICS_RQUEUE_NAME || 'analytics:refund:queue';
const SEAT_RELEASED_PUBSUB_NAME = process.env.SEAT_RELEASED_PUBSUB_NAME || "seat-released";
const NOTIFICATION_PUBSUB_NAME = process.env.NOTIFICATION_PUBSUB_NAME || 'notification:pubsub';
const TTL_MIN = process.env.TTL_MIN ? parseInt(process.env.TTL_MIN) : 10;


const client = redis.createClient({ url: redisUrl });
client.on("error", (err) => console.error("Refund Redis error:", err.message));

const db = new pg.Pool({ connectionString: DATABASE_URL });
db.on('error', (err) => {
  console.error('Postgres error:', err.message);
});

const startTime = Date.now();

function refundIdemKey(idemKey){
  return `refund-idem:${idemKey}`;
}

function refundDataKey(idemKey){
  return `refund-data:${idemKey}`;
}

app.get("/health", async (_req, res) =>{
  const checks = {};
  let healthy = true;

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

  // Check PostgreSQL
  const dbStart = Date.now();
  try {
    await db.query('SELECT 1');
    checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart };
  } catch (err) {
    checks.database = { status: 'unhealthy', error: err.message };
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

app.get("/seat-released", (_req, res) => {
  res.status(200).json({
      event: "seat-released",
      message: "placeholder response",
      published: false
  });
});

app.post("/refund", async (req, res) => {
  const { purchaseId, seats, idemKey } = req.body;

  //verify input
  if (!purchaseId || !Number.isInteger(seats) || seats <= 0 || !idemKey){
    return res.status(400).json({
      message: "Proper purchaseID, seats, and idemKey are required"
    })
  }

  // claim job for idempotency
  const claimed = await client.set(refundIdemKey(idemKey), "1", {
     NX: true, 
     EX: TTL_MIN * 60
  });

  if (!claimed) {
    const state = await client.hGet(refundDataKey(idemKey), "state");
    const statusCode = await client.hGet(refundDataKey(idemKey), "status");
    const responseStr = await client.hGet(refundDataKey(idemKey), "response");

    const response = responseStr ? JSON.parse(responseStr) : {};
    const status = statusCode ? parseInt(statusCode) : 409;

    if (state === "processing") {
      return res.status(409).json({
        message: "Duplicate refund detected; request still processing",
      });
    }

    return res.status(status).json({
      ...response,
      duplicate: true,
      duplicateMessage: `Duplicate refund detected; previous request completed with status ${state}`,
    });
  }

  await client.hSet(refundDataKey(idemKey), {
    state: "processing",
    status: "",
    response: "",
  });
  await client.expire(refundDataKey(idemKey), TTL_MIN * 60);

  let refundId;

  try{
    //Ticket-purchase verifies that this purchase exists
    //and that the requested number of seats can be refunded
    const verifyRes = await fetch(`${TICKET_PURCHASE_URL}/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({purchaseId, seats})
    });

    if(!verifyRes.ok){
      const verifyBody = await verifyRes.json().catch(() => ({}));
      const message = verifyBody.message || "Purchase verification failed";

      await client.hSet(refundDataKey(idemKey), {
        state: "failed",
        status: String(verifyRes.status),
        response: JSON.stringify({ message }),
      });

      return res.status(verifyRes.status).json({ message });
    }

    const verifyData = await verifyRes.json();
    const purchase = verifyData;

    //Get data from the verified purchase.
    // ticket_purchases.charge is the total original purchase cost
    const eventId = purchase.event_id;
    const paymentId = purchase.payment_id;
    const originalSeats = purchase.purchased_seats;
    const originalCharge = purchase.charge;

    if (!eventId || !paymentId || !originalSeats || !originalCharge) {
      const message = "Verified purchase missing event_id, payment_id, original seats, or original charge";

      await client.hSet(refundDataKey(idemKey), {
        state: "failed",
        status: "500",
        response: JSON.stringify({ message }),
      });

      return res.status(500).json({ message });
    }

    const refundAmount = (originalCharge / originalSeats) * seats;

    //Store pending refund
    const insertRefundRes = await db.query(
      `INSERT INTO refunds (
        purchase_id,
        event_id,
        payment_id,
        seats,
        amount,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [purchaseId, eventId, paymentId, seats, refundAmount, "pending"]
    );

    refundId = insertRefundRes.rows[0].id;

    //Call payment service to actually give refund
    const paymentRefundRes = await fetch(`${PAYMENT_URL}/refund`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        paymentID: paymentId,
        purchaseId,
        amount: refundAmount,
      }),
    });

    if (!paymentRefundRes.ok) {
      const paymentBody = await paymentRefundRes.json().catch(() => ({}));
      const message = paymentBody.message || "Payment refund failed";

      await db.query(
        `UPDATE refunds
        SET status = $2, reason = $3
        WHERE id = $1`,
        [refundId, "failed", message]
      );

      await client.hSet(refundDataKey(idemKey), {
        state: "failed",
        status: String(paymentRefundRes.status),
        response: JSON.stringify({ message }),
      });

      return res.status(paymentRefundRes.status).json({ message });
    }

    await paymentRefundRes.json().catch(() => ({}));

    //once payment is successful, unreserve seats in evnet-catalog
    const unreserveRes = await fetch(`${EVENT_CATALOG_URL}/unreserve-seats`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        event_id: eventId,
        seats,
      }),
    });

    if (!unreserveRes.ok) {
      const unreserveBody = await unreserveRes.json().catch(() => ({}));
      const message = unreserveBody.message || "Failed to unreserve seats";

      await db.query(
        `UPDATE refunds
         SET status = $2, reason = $3
         WHERE id = $1`,
        [refundId, "failed", message]
      );

      await client.hSet(refundDataKey(idemKey), {
        state: "failed",
        status: String(unreserveRes.status),
        response: JSON.stringify({ message }),
      });

      return res.status(unreserveRes.status).json({ message });
    }

    const ticketPurchaseRefundRes = await fetch(`${TICKET_PURCHASE_URL}/refund`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        purchaseId,
      }),
    });

    if (!ticketPurchaseRefundRes.ok) {
      const ticketPurchaseRefundBody = await ticketPurchaseRefundRes.json().catch(() => ({}));
      const message = ticketPurchaseRefundBody.message || "Failed to update ticket-purchase refund";

      await db.query(
        `UPDATE refunds
        SET status = $2, reason = $3
        WHERE id = $1`,
        [refundId, "failed", message]
      );

      await client.hSet(refundDataKey(idemKey), {
        state: "failed",
        status: String(ticketPurchaseRefundRes.status),
        response: JSON.stringify({ message }),
      });

      return res.status(ticketPurchaseRefundRes.status).json({ message });
    }

    //Push refund event to analytics queue.
    const analyticsPayload = {
      idemKey: String(refundId),
      eventType: "refund",
      sourceService: SERVICE_NAME,
      eventId,
      userId: req.user?.id ?? null,
      seats,
      priceUsd: refundAmount,
      emittedAt: new Date().toISOString(),
      payload: { refundId, purchaseId, paymentId },
    };
    await client.lPush(ANALYTICS_RQUEUE_NAME, JSON.stringify(analyticsPayload));

    //publish seat-released event if seat opens up 
    await client.publish(
      SEAT_RELEASED_PUBSUB_NAME,
      JSON.stringify({
        type: "seat-released",
        source: "refund",
        refundId,
        purchaseId,
        eventId,
        seats,
        releasedAt: new Date().toISOString(),
      })
    );

    //Publish notification event
    await client.publish(
      NOTIFICATION_PUBSUB_NAME,
      JSON.stringify({
        type: "refund",
        refundId,
        purchaseId,
        eventId,
        paymentId,
        seats,
        amount: refundAmount,
      })
    );

    //Mark refund completed in refund db
    await db.query(
      `UPDATE refunds
       SET status = $2
       WHERE id = $1`,
      [refundId, "completed"]
    );

    const successResponse = {
      message: "Refund successful",
      refundId,
      purchaseId,
      eventId,
      paymentId,
      seats,
      amount: refundAmount,
    };

    await client.hSet(refundDataKey(idemKey), {
      state: "success",
      status: "200",
      response: JSON.stringify(successResponse),
    });

    return res.status(200).json(successResponse);
  } catch (err) {
    console.error("Refund endpoint error:", err.message);

     if (refundId) {
      await db.query(
        `UPDATE refunds
         SET status = $2, reason = $3
         WHERE id = $1`,
        [refundId, "failed", err.message]
      );
    }

    await client.hSet(refundDataKey(idemKey), {
      state: "failed",
      status: "500",
      response: JSON.stringify({
        message: "Internal refund service error",
        error: err.message,
      }),
    });

    return res.status(500).json({
      message: "Internal refund service error",
      error: err.message,
    });
  }
});


await client.connect();

app.listen(port, () => {
  console.log(`Refund service running on port ${port}`);
});