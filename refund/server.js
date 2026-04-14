import express from "express";
import redis from "redis";

const app = express();
const port = process.env.PORT || 3000;
const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
const SERVICE_NAME = process.env.SERVICE_NAME || 'refund';

const client = redis.createClient({ url: redisUrl });
client.on("error", (err) => console.error("Refund Redis error:", err.message));

const startTime = Date.now();

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

await client.connect();

app.listen(port, () => {
  console.log(`Refund service running on port ${port}`);
});