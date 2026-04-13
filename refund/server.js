import express from "express";
import redis from "redis";

const app = express();
const port = process.env.PORT || 3000;
const redisUrl = process.env.REDIS_URL || "redis://redis:6379";

const client = redis.createClient({ url: redisUrl });
client.on("error", (err) => console.error("Refund Redis error:", err.message));

await client.connect();

app.listen(port, () => {
  console.log(`Refund service running on port ${port}`);
});