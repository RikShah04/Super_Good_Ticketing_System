import express from "express";
import redis from "redis";

const app = express();
const port = Number(process.env.PORT || "3000");

const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
const SUB_NAME = process.env.NOTIFICATION_SUB_KEY ?? 'notification:pubsub'
const client = redis.createClient({ url: redisUrl })



const startTime = Date.now()

client.on("error", (err) => {
    console.error("Redis error:", err.message)
})

app.use(express.json());
app.use(express.urlencoded({ extended: true}));

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") {
        return res.sendStatus(200);
    }
    next();
});

app.get('/health', async (req, res) => {
  const checks = {}
  let healthy = true

  // Check Redis
  const redisStart = Date.now()
  try {
    const pong = await client.ping()
    if (pong !== 'PONG') throw new Error(`unexpected response: ${pong}`)
    checks.redis = { status: 'healthy', latency_ms: Date.now() - redisStart }
  } catch (err) {
    checks.redis = { status: 'unhealthy', error: err.message }
    healthy = false
  }

  const body = {
    status: healthy ? 'healthy' : 'unhealthy',
    service: process.env.SERVICE_NAME ?? 'Notification Service',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    checks,
  }

  res.status(healthy ? 200 : 503).json(body)
})

async function sendNotification(data) {
  console.log(data)
}

await client.connect();
await client.subscribe(SUB_NAME, (msg) => {
  sendNotification(JSON.parse(msg));
});

app.listen(port, () => {
    console.log(`Notification service listening on port ${port}`);
});