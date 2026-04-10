import express from 'express';
import redis from 'redis';

const app = express();

const client = redis.createClient();
client.on('error', (err) => {
  console.error('Redis error:', err);
});


app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
