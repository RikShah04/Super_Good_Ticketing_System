import express from "express";
import pg from 'pg';
import crypto from 'crypto';

const app = express();
const port = 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const SERVICE_NAME = process.env.SERVICE_NAME || 'payments';
const INSTANCE_ID = process.env.HOSTNAME || 'unknown';

const startTime = Date.now();

/**
 * GET /health
 * Returns overall service health.
 *
 * Provides a snapshot of service status, uptime, and dependency checks.
 * Includes Postgres/database connectivity and latency.
 *
 * Example response:
 * {
 *   status: "healthy" | "unhealthy",
 *   service: "payments",
 *   timestamp: ISOString,
 *   uptime_seconds: number,
 *   checks: {
 *     database: {
 *       status: "healthy" | "unhealthy",
 *       latency_ms?: number,
 *       error?: string
 *     }
 *   }
 * }
 *
 * @returns {200} Service healthy
 * @returns {503} Service unhealthy
 */
app.get('/health', async (req, res) => {
  const checks = {}
  let healthy = true

  // Check PostgreSQL
  const dbStart = Date.now()
  try {
    await pool.query('SELECT 1')
    checks.database = { status: 'healthy', latency_ms: Date.now() - dbStart }
  } catch (err) {
    checks.database = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  const body = {
    status: healthy ? 'healthy' : 'unhealthy',
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
    instance: INSTANCE_ID,
    hostname: INSTANCE_ID,
  }

  res.status(healthy ? 200 : 503).json(body)
})

async function returnError(res, statusCode, errorMessage){
  res.status(statusCode).json({
      status: 'failure',
      error: errorMessage,
      timestamp: new Date().toISOString(),
  })
}

/**
 * POST /process
 * Processes a payment.
 *
 * Validates input, simulates processing, and stores a payment token.
 *
 * Example request body:
 * {
 *   cc: "3790123453827313",
 *   cvv: "123",
 *   expiry: "10/27",
 *   cardType: "Visa",
 *   price: 100.00
 * }
 *
 * Example success response:
 * {
 *   status: "success",
 *   paymentID: string,
 *   paymentToken: string,
 *   timestamp: ISOString
 * }
 *
 * @returns {200} Payment processed
 * @returns {400} Invalid input
 * @returns {500} Processing error
 */
app.post('/process', async (req, res) => {

  const paymentID = crypto.randomUUID();

  const { cc, cvv, expiry, cardType, price} = req.body;

  // Data validation
  if(cc && (cc.length < 15)){
    return returnError(res, 400, 'Invalid CC');
  }
  if (cvv && (cvv.length !== 3 && cvv.length !== 4)){
    return returnError(res, 400, 'Invalid CVV');
  }
  if(expiry && (expiry.length != 5)){
    return returnError(res, 400, 'Invalid Expiry');
  }
  if (cardType && !['Amex', 'Visa', 'Master'].includes(cardType)){
    return returnError(res, 400, 'Invalid Card Type');
  }
  if (price == null || isNaN(Number(price)) || Number(price) < 0){
    return returnError(res, 400, 'Invalid Payment Amount');
  }

  console.log(`Processing Payment ${paymentID}...`);

  // Sleep for 2 seconds simulating work
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Create card token that simulates something returned from a service like Stripe
  const paymentToken = 'tok_' + crypto.randomBytes(12).toString('hex');

  // Store in DB
  try{

    await pool.query(
      `INSERT INTO payments (payment_id, token, price, amount_refunded, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [paymentID, paymentToken, price, 0, 'success']
    );

    console.log(`Payment ${paymentID} processed!`);

    return res.status(200).json({
      status: 'success',
      paymentID: paymentID,
      paymentToken: paymentToken,
      timestamp: new Date().toISOString(),
    });

  }catch(err){
    return returnError(res, 500, 'A server error occured when attempting to process payment');
  }

})

/**
 * POST /refund
 * Refunds a payment.
 *
 * Supports full and partial refunds by updating stored payment records in db
 *
 * Example request body:
 * {
 *   paymentID: "uuid",
 *   amount: 50.00
 * }
 *
 * Example success response:
 * {
 *   status: "partial_refund" | "refunded",
 *   paymentID: string,
 *   timestamp: ISOString
 * }
 *
 * @returns {200} Refund successful
 * @returns {400} Invalid request (e.g. not found, exceeds refundable amount)
 * @returns {500} Processing error
 */
app.post('/refund', async (req, res) => {
  const { paymentID, amount } = req.body;
  const amountNum = Number(amount);

  let isPartialRefund = true;

  try{
    const result = await pool.query(
      `SELECT price, amount_refunded
      FROM payments
      WHERE payment_id = $1`,
      [paymentID]
    );

    if (result.rowCount === 0) {
      return returnError(res, 400, 'Payment ID Not Found');
    }

    const { price, amount_refunded } = result.rows[0];
    const priceNum = Number(price), amount_refundedNum = Number(amount_refunded);

    if (amountNum + amount_refundedNum > priceNum) {
      return returnError(res, 400, 'Refund exceeds original payment amount');
    }

    if (amountNum + amount_refundedNum >= priceNum) isPartialRefund = false;

    await pool.query(
      `UPDATE payments
      SET amount_refunded = amount_refunded + $1,
          status = CASE 
            WHEN amount_refunded + $1 >= price THEN 'refunded'
            ELSE 'partial_refund'
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE payment_id = $2`,
      [amountNum, paymentID]
    );


    console.log(`Payment ${paymentID} refunded with amount ${amountNum} and type ${isPartialRefund ? 'partial_refund' : 'refunded'}!`);

    return res.status(200).json({
      status: isPartialRefund ? 'partial_refund' : 'refunded',
      paymentID: paymentID,
      timestamp: new Date().toISOString(),
    });

  }catch(err){
    return returnError(res, 500, 'A server error occured when attempting to process refund');
  }

})

app.listen(port, () => {
  console.log(`Payment Service API running on port ${port}`);
});