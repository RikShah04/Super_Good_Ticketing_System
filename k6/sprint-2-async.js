// Sprint 2 — Async pipeline burst test
//
// Run from inside the holmes container:
//   docker compose exec holmes bash
//   k6 run /workspace/k6/sprint-2-async.js
//
// Or from your host machine if k6 is installed:
//   k6 run k6/sprint-2-async.js
//
// Replace TARGET_URL with your main read endpoint.

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");

// ── Configuration ─────────────────────────────────────────────────────────────
// Update this URL to point to your main read endpoint.
// From inside the holmes container, use the service name (not localhost).
const PURCHASE_URL = `http://ticket-purchase:3000/purchase`;
const WORKER_HEALTH_URL = "http://waitlist:3000/health";

export const options = {
  vus: 50,          // burst of 50 concurrent users
  duration: "10s",  // short time
  thresholds: {
    http_req_duration: ["p(95)<2000"], // higher since payment is blocking
    errors: ["rate<0.01"],
  },
};

function buildPayload(idemKey, eventId = "fb9220d9-b0fd-4322-8486-492457c38909", seats = 1) {
  return JSON.stringify({
    idemKey,
    eventId,
    seats,
    paymentInfo: {
      cc: "4111111111111111",
      cvv: "123",
      expiry: "12/28",
      cardType: "visa",
    },
  });
}

export default function () {
  const idemKey = `purchase-${__VU}-${__ITER}`;

  const payload = buildPayload(idemKey);
  const params = {
    headers: { "Content-Type": "application/json" },
  };

  //purchase requests 
  const res = http.post(PURCHASE_URL, payload, params);

  const ok = check(res, {
    "status is expected": (r) =>
        [200, 400, 404, 409].includes(r.status), // gives error codes that event ticketing uses to signal not enough seats, client-errored failure, and event not found
    "response time < 2s": (r) => r.timings.duration < 2000,
  });

  errorRate.add(!ok);

  //duplicate request with SAME idemKey
  const dupRes = http.post(PURCHASE_URL, payload, params);

  const duplicateOk = check(dupRes, {
    "duplicate returned expected status": (r) =>
      [200, 400, 404, 409, 500].includes(r.status),
    "duplicate response has message": (r) => {
      const msg = r.json("message");
      return typeof msg === "string" && msg.length > 0;
    },
  });

  errorRate.add(!duplicateOk);

  //checks worker health
  const workerHealthRes = http.get(WORKER_HEALTH_URL);

  const workerHealthOk = check(workerHealthRes, {
    "worker health endpoint reachable": (r) => r.status === 200 || r.status === 503,
    "worker reports queue depth": (r) => r.json("checks.queue.depth") !== null,
    "worker reports jobs processed": (r) => r.json("checks.worker.jobs_processed") !== null,
  });

  errorRate.add(!workerHealthOk);

  sleep(0.1); // smaller sleep to mimic burst
}
