import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Counter } from 'k6/metrics'

const errors = new Rate('errors')

const catalogHealthByInstance = new Counter('catalog_health_by_instance')

const TRAFFIC_URL = 'http://event-catalog:3005'
const EVENT_CATALOG_URL = 'http://event-catalog:3005'

const GET_PARAMS = {
  catalog_list: { timeout: '15s', tags: { type: 'catalog_list' } },
  health_poll: { timeout: '15s', tags: { type: 'health_poll' } },
}

function parseJsonSafe(res) {
  if (res.status === 0 || !res.body?.length) return null
  try {
    return res.json()
  } catch {
    return null
  }
}

export const options = {
  scenarios: {
    sustained_events: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 20 },
        { duration: '30s', target: 20 },
        { duration: '10s', target: 0 },
      ],
      exec: 'sustainedEvents',
    },
    catalog_health_poller: {
      executor: 'constant-vus',
      vus: 1,
      duration: '70s',
      exec: 'pollCatalogHealth',
      gracefulStop: '5s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<5000', 'p(99)<8000'],
    errors: ['rate<0.05'],
  },
}

export function setup() {
  const res = http.get(`${EVENT_CATALOG_URL}/events?limit=1`)
  if (res.status !== 200) {
    throw new Error(
      `event-catalog /events returned ${res.status} — is the service running and seeded?`,
    )
  }
  const body = res.json()
  const list = body.events
  if (!list || list.length === 0) {
    throw new Error('event-catalog returned no events — run: docker compose exec event-catalog npm run seed')
  }
  const ev = list[0]
  console.log(
    `setup: catalog ok — sample event ${ev.id} (${ev.name || 'unnamed'}), ${ev.availableseats} seats left`,
  )
  return {}
}

export function sustainedEvents() {
  const res = http.get(`${TRAFFIC_URL}/events?page=1&limit=20`, GET_PARAMS.catalog_list)

  const j = parseJsonSafe(res)
  const ok = check(res, {
    'list: TCP/HTTP responded': (r) => r.status > 0,
    'list: status 200': (r) => r.status === 200,
    'list: has events array': () => Array.isArray(j?.events),
  })
  errors.add(!ok)

  sleep(0.35)
}

export function pollCatalogHealth() {
  const res = http.get(`${EVENT_CATALOG_URL}/health`, GET_PARAMS.health_poll)

  const j = parseJsonSafe(res)
  const ok = check(res, {
    'health: TCP/HTTP responded': (r) => r.status > 0,
    'health: reachable': (r) => r.status === 200 || r.status === 503,
    'health: parsed JSON': () => j != null,
    'health: top-level status present': () =>
      j != null && ['healthy', 'unhealthy'].includes(j.status),
    'health: instance field present': () => typeof j?.instance === 'string',
  })
  errors.add(!ok)

  const inst =
    typeof j?.instance === 'string' && j.instance.length > 0
      ? j.instance
      : typeof j?.hostname === 'string' && j.hostname.length > 0
        ? j.hostname
        : 'unknown'
  if ((res.status === 200 || res.status === 503) && j != null) {
    catalogHealthByInstance.add(1, { instance: inst })
  }

  sleep(4)
}
