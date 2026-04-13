import express from "express";
import redis from "redis";

const app = express();
const port = process.env.PORT || 3000;

const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
const queueName = process.env.QUEUE_NAME || "orders:queue";