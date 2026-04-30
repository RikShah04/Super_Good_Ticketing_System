
import http from "k6/http";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");

// ── Configuration ─────────────────────────────────────────────────────────────
// Update this URL to point to your main read endpoint.
// From inside the holmes container, use the service name (not localhost).
const TARGET_URL = "http://event-catalog:3005/events";


export const options = {
  stages: [
    { duration: '10s', target: 100 },  // warm-up: same load as Scenario 2
    { duration: '20s', target: 300 },   // ramp: increasing pressure
    { duration: '20s', target: 500 },   // ramp: heavy pressure
    { duration: '20s', target: 800 },   // ramp: extreme pressure
    { duration: '10s', target: 0 },     // cool-down
  ],

  // Thresholds define pass/fail criteria. k6 will report whether the system
  // met these targets. These are intentionally set to values that should be
  // achievable at low VU counts but will likely fail under extreme load.
  thresholds: {
    http_req_duration: ['p(95)<2000'],  // p95 latency under 2 seconds
    http_req_failed: ['rate<0.10'],     // fewer than 10% of requests fail
  },
};

export default function () {
  const res = http.get(TARGET_URL);

  // check() records pass/fail rates in k6 output so you can see at what
  // point responses stop being successful.
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response has hostname': (r) => {
      try {
        return JSON.parse(r.body).hostname !== undefined;
      } catch {
        return false;
      }
    },
  });
}