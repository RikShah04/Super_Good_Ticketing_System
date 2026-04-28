import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend, Counter } from 'k6/metrics'

const validErrorRate = new Rate('valid_errors')
const dlqDepthTrend = new Trend('dlq_depth')
// incremented each time the health poller observes the DLQ depth grow —
// proves the DLQ is accumulating, not just non-zero at one snapshot
const dlqGrowthEvents = new Counter('dlq_growth_events')

const BASE_URL = 'http://ticket-purchase:3000/purchase'
const WORKER_HEALTH_URL = 'http://fraud-worker:3000/health'
const EVENT_CATALOG_URL = 'http://event-catalog:3005'

// 80% valid requests, 20% poison pills across 20 VUs.
// One separate VU to check for DLQ health poller
export const options = {
  scenarios: {
    mixed_traffic: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 20 },
        { duration: '30s', target: 20 },
        { duration: '10s', target: 0 },
      ],
      exec: 'mixedTraffic',
    },
    health_poller: {
      executor: 'constant-vus',
      vus: 1,
      duration: '70s',
      exec: 'pollHealth',
      gracefulStop: '5s',
    },
  },
  thresholds: {
    // Payment service has 2 sec wait time, increased valid time to account for it.
    'http_req_duration{type:valid}': ['p(95)<3000'],
    valid_errors: ['rate<0.1'],
    dlq_depth: ['max>0'],
    dlq_growth_events: ['count>0'],
  },
}

// Fetch real eventID, must seed before running k6
export function setup() {
  const res = http.get(`${EVENT_CATALOG_URL}/events?limit=1`)
  if (res.status !== 200) {
    throw new Error(`event-catalog /events returned ${res.status} — is the service running?`)
  }
  const body = res.json()
  const events = body.events
  if (!events || events.length === 0) {
    throw new Error('event-catalog returned no events — run the seed script first')
  }
  const event = events[0]
  console.log(`Using event ${event.id} (${event.name || 'unnamed'}, $${event.priceusd}, ${event.availableseats} seats)`)
  return { eventId: event.id }
}

function validOrder(data) {
  return JSON.stringify({
    eventId: data.eventId,
    seats: 1,
    paymentInfo: {
      cc: '4111111111111111',
      cvv: '123',
      expiry: '04/29',
      cardType: 'Visa',
    },
    idemKey: `purchase-s3-${__VU}-${__ITER}`,
  })
}

function poisonOrder(data) {
  const variants = [
    // cc is 17 digits — passes payment (length >= 15) but fails fraud (length > 16)
    JSON.stringify({
      eventId: data.eventId,
      seats: 1,
      paymentInfo: { cc: '41111111111111111', cvv: '123', expiry: '04/29', cardType: 'Visa' },
      idemKey: `poison-s3-long-${__VU}-${__ITER}`,
    }),
    // cc is 16 chars with a non-digit — passes payment (length OK) but fails
    // fraud's /^\d{15,16}$/ regex check
    JSON.stringify({
      eventId: data.eventId,
      seats: 1,
      paymentInfo: { cc: '4111X11111111111', cvv: '123', expiry: '04/29', cardType: 'Visa' },
      idemKey: `poison-s3-alpha-${__VU}-${__ITER}`,
    }),
    // cc is 15 chars with a non-digit — same reason as above, different length path
    JSON.stringify({
      eventId: data.eventId,
      seats: 1,
      paymentInfo: { cc: '411111111111X11', cvv: '123', expiry: '04/29', cardType: 'Visa' },
      idemKey: `poison-s3-alpha15-${__VU}-${__ITER}`,
    }),
  ]
  return variants[Math.floor(Math.random() * variants.length)]
}

// Dedicated VU that polls /health every 3 s and tracks DLQ growth.
let seenMaxDlq = 0

export function pollHealth() {
  const res = http.get(WORKER_HEALTH_URL, { tags: { type: 'health_poll' } })

  check(res, {
    'worker health endpoint reachable': (r) => r.status === 200 || r.status === 503,
    'worker not crashed': (r) => ['healthy', 'degraded'].includes(r.json('checks.worker.status')),
  })

  const depth = res.json('checks.queue.dlq_depth')
  if (typeof depth === 'number') {
    dlqDepthTrend.add(depth)
    if (depth > seenMaxDlq) {
      dlqGrowthEvents.add(1)
      seenMaxDlq = depth
    }
  }

  sleep(3)
}

export function mixedTraffic(data) {
  if (Math.random() < 0.2) {
    const res = http.post(BASE_URL, poisonOrder(data), {
      headers: { 'Content-Type': 'application/json' },
      tags: { type: 'poison' },
    })
    check(res, {
      'poison: accepted for async processing': (r) => r.status === 200,
    })
  } else {
    const res = http.post(BASE_URL, validOrder(data), {
      headers: { 'Content-Type': 'application/json' },
      tags: { type: 'valid' },
    })
    const ok = check(res, {
      'valid: completed successfully': (r) => r.status === 200,
      'valid: not a server error': (r) => r.status < 500,
    })
    validErrorRate.add(!ok)
  }

  sleep(0.5)
}
