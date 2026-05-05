import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate("errors");

// Run with: k6 run k6/sprint-4-scale.js
// Do this for both scaled and unscaled version

const BASE_URL = 'http://event-catalog:3005';
const SCALE = __ENV.SCALE || 'single';


export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '60s', target: 50 }, // push harder than Sprint 1 to show scaling benefit
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: [
      "p(50)<500",
      "p(95)<500",
      "p(99)<500"
    ],
    errors: ["rate<0.01"],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/events`);
  check(res, { 'status is 200': r => r.status === 200 });
  sleep(0.5);
}
