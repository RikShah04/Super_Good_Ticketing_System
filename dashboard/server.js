import express from 'express';
import { createClient } from 'redis';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const PORT = process.env.PORT || 3000;
const DOCKER_SOCKET = '/var/run/docker.sock';
const EVENT_CATALOG_CONTAINER = process.env.EVENT_CATALOG_CONTAINER || 'event-catalog';
const HOLMES_CONTAINER = process.env.HOLMES_CONTAINER || 'holmes';

const SERVICES = [
  { name: 'ticket-purchase', url: 'http://ticket-purchase:3000/health' },
  { name: 'payment',         url: 'http://payment:3001/health' },
  { name: 'refund',          url: 'http://refund:3000/health' },
  { name: 'fraud-worker',    url: 'http://fraud-worker:3000/health' },
  { name: 'analytics',       url: 'http://analytics:3000/health' },
  { name: 'notification',    url: 'http://notification:3000/health' },
  { name: 'event-catalog',   url: 'http://event-catalog:3005/health' },
  { name: 'waitlist',        url: 'http://waitlist:3000/health' },
  { name: 'users',           url: 'http://users:3006/health' },
];

const QUEUES = [
  { name: 'fraud:queue',              label: 'Fraud Queue' },
  { name: 'fraud:dlq',               label: 'Fraud DLQ' },
  { name: 'analytics:purchase:queue', label: 'Analytics Purchase' },
  { name: 'analytics:browse:queue',   label: 'Analytics Browse' },
  { name: 'analytics:refund:queue',   label: 'Analytics Refund' },
  { name: 'analytics:dlq',           label: 'Analytics DLQ' },
  { name: 'waitlist-jobs',           label: 'Waitlist Jobs' },
  { name: 'waitlist:dlq',            label: 'Waitlist DLQ' },
];

// ── Docker stats cache (updated every 5s in background) ───────────────────────
const statsCache  = new Map(); // service → { cpuPct, rxRate, txRate }
const prevNetCache = new Map(); // service → { rx, tx, ts }

async function refreshStats() {
  try {
    const listRes = await dockerApi('GET', '/v1.41/containers/json');
    const containers = JSON.parse(listRes.body.toString());

    const serviceToId = new Map();
    for (const c of containers) {
      const svc = c.Labels?.['com.docker.compose.service'];
      if (svc) serviceToId.set(svc, c.Id);
    }

    await Promise.all(SERVICES.map(async ({ name }) => {
      const id = serviceToId.get(name);
      if (!id) return;
      try {
        const r = await dockerApi('GET', `/v1.41/containers/${id}/stats?stream=false`);
        const s = JSON.parse(r.body.toString());

        const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
        const sysDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
        const ncpu = s.cpu_stats.online_cpus || 1;
        const cpuPct = sysDelta > 0 ? Math.round((cpuDelta / sysDelta) * ncpu * 1000) / 10 : 0;

        const nets = Object.values(s.networks || {});
        const rx = nets.reduce((a, n) => a + n.rx_bytes, 0);
        const tx = nets.reduce((a, n) => a + n.tx_bytes, 0);
        const now = Date.now();

        const prev = prevNetCache.get(name);
        let rxRate = 0, txRate = 0;
        if (prev) {
          const dt = (now - prev.ts) / 1000;
          rxRate = dt > 0 ? Math.round((rx - prev.rx) / dt) : 0;
          txRate = dt > 0 ? Math.round((tx - prev.tx) / dt) : 0;
        }
        prevNetCache.set(name, { rx, tx, ts: now });
        statsCache.set(name, { cpuPct, rxRate: Math.max(0, rxRate), txRate: Math.max(0, txRate) });
      } catch { /* container temporarily unavailable */ }
    }));
  } catch (err) {
    console.error('Stats refresh error:', err.message);
  }
}

refreshStats();
setInterval(refreshStats, 5000);

const K6_SCRIPTS = [
  { id: 'sprint-3-poison',  label: 'Sprint 3 — Purchase Pipeline (fraud + analytics queues, ~70s)' },
  { id: 'sprint-4-scale',   label: 'Sprint 4 — Scale Test (event-catalog reads, ~100s)' },
  { id: 'sprint-4-replica', label: 'Sprint 4 — Replica Test (event-catalog reads, ~70s)' },
  { id: 'sprint-2-cache',   label: 'Sprint 2 — Cache Test (event-catalog reads, ~70s)' },
];

// ── Redis ─────────────────────────────────────────────────────────────────────

const redis = createClient({ url: REDIS_URL });
redis.on('error', (err) => console.error('Redis error:', err));
await redis.connect();

// ── Docker Engine API (Unix socket) ───────────────────────────────────────────

function dockerApi(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      socketPath: DOCKER_SOCKET,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = httpRequest(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// Docker multiplexed stream parser (Tty: false output)
function parseDockerStream(buf) {
  let out = '';
  let i = 0;
  while (i + 8 <= buf.length) {
    const size = buf.readUInt32BE(i + 4);
    out += buf.slice(i + 8, i + 8 + size).toString('utf8');
    i += 8 + size;
  }
  return out || buf.toString('utf8');
}

async function execInContainer(container, cmd, detach = false) {
  const create = await dockerApi('POST', `/v1.41/containers/${container}/exec`, {
    AttachStdout: !detach,
    AttachStderr: !detach,
    Tty: false,
    Cmd: cmd,
  });
  if (create.status !== 201) {
    throw new Error(`exec create failed (${create.status}): ${create.body.toString()}`);
  }
  const { Id } = JSON.parse(create.body.toString());

  const start = await dockerApi('POST', `/v1.41/exec/${Id}/start`, {
    Detach: detach,
    Tty: false,
  });

  return { execId: Id, output: detach ? null : parseDockerStream(start.body) };
}

async function getExecStatus(execId) {
  const res = await dockerApi('GET', `/v1.41/exec/${execId}/json`);
  return JSON.parse(res.body.toString());
}

// ── k6 run state ──────────────────────────────────────────────────────────────

let k6State = { running: false, execId: null, script: null, startedAt: null };

function pollK6(execId) {
  const interval = setInterval(async () => {
    try {
      const info = await getExecStatus(execId);
      if (!info.Running) {
        k6State = { running: false, execId: null, script: null, startedAt: null };
        clearInterval(interval);
        console.log('k6 run finished, exit code:', info.ExitCode);
      }
    } catch (err) {
      console.error('k6 poll error:', err.message);
      k6State = { running: false, execId: null, script: null, startedAt: null };
      clearInterval(interval);
    }
  }, 5000);
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

// ── Health checks ─────────────────────────────────────────────────────────────

async function checkService(svc) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(svc.url, { signal: controller.signal });
    const body = await res.json().catch(() => ({}));
    const stats = statsCache.get(svc.name) ?? null;
    return {
      name: svc.name,
      status: res.ok ? 'healthy' : 'unhealthy',
      uptime_seconds: body.uptime_seconds ?? null,
      latency_ms: body.checks?.database?.latency_ms ?? null,
      instance: body.instance ?? null,
      cpuPct: stats?.cpuPct ?? null,
      rxRate: stats?.rxRate ?? null,
      txRate: stats?.txRate ?? null,
    };
  } catch (err) {
    const stats = statsCache.get(svc.name) ?? null;
    return { name: svc.name, status: 'unreachable', error: err.message,
             cpuPct: stats?.cpuPct ?? null, rxRate: stats?.rxRate ?? null, txRate: stats?.txRate ?? null };
  } finally {
    clearTimeout(timeout);
  }
}

async function getQueueDepths() {
  return Promise.all(
    QUEUES.map(async (q) => {
      try {
        const type = await redis.type(q.name);
        let depth = 0;
        if (type === 'list') depth = await redis.lLen(q.name);
        else if (type === 'zset') depth = await redis.zCard(q.name);
        return { name: q.name, label: q.label, depth, type };
      } catch {
        return { name: q.name, label: q.label, depth: -1, type: 'error' };
      }
    })
  );
}

async function getRecentPurchases() {
  try {
    const keys = [];
    let cursor = '0';
    do {
      const result = await redis.scan(cursor, { MATCH: 'purchase-data:*', COUNT: 100 });
      cursor = result.cursor;
      keys.push(...result.keys);
    } while (cursor !== '0' && keys.length < 100);

    const purchases = await Promise.all(
      keys.slice(0, 50).map(async (key) => {
        const data = await redis.hGetAll(key);
        const idemKey = key.replace('purchase-data:', '');
        let response = {};
        try { response = data.response ? JSON.parse(data.response) : {}; } catch {}
        return {
          idemKey,
          state: data.state ?? 'unknown',
          statusCode: data.status ?? null,
          purchaseId: response.purchase?.id ?? response.id ?? null,
          eventId: response.purchase?.eventId ?? response.eventId ?? null,
          seats: response.purchase?.purchasedSeats ?? response.seats ?? null,
          charge: response.purchase?.charge ?? response.charge ?? null,
        };
      })
    );

    purchases.sort((a, b) => {
      const order = { processing: 0, success: 1, failed: 2, unknown: 3 };
      return (order[a.state] ?? 3) - (order[b.state] ?? 3);
    });

    return purchases;
  } catch (err) {
    console.error('Error scanning purchases:', err);
    return [];
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

app.get('/api/status', async (_req, res) => {
  const [services, queues, purchases] = await Promise.all([
    Promise.all(SERVICES.map(checkService)),
    getQueueDepths(),
    getRecentPurchases(),
  ]);
  const redisInfo = await redis.ping().then(() => 'connected').catch(() => 'disconnected');
  res.json({ timestamp: new Date().toISOString(), redis: redisInfo, services, queues, purchases });
});

app.get('/api/events', async (req, res) => {
  const { page = 1, limit = 20, venue = '' } = req.query;
  try {
    const qs = new URLSearchParams({ page, limit, ...(venue ? { venue } : {}) });
    const r = await fetch(`http://event-catalog:3005/events?${qs}`);
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

app.get('/api/k6/scripts', (_req, res) => res.json(K6_SCRIPTS));

app.post('/api/admin/seed', async (_req, res) => {
  try {
    const { output } = await execInContainer(EVENT_CATALOG_CONTAINER, ['node', 'seedEvents.js']);
    // Bust the event-catalog Redis cache so the new events appear immediately
    const cacheKeys = await redis.keys('events:*');
    if (cacheKeys.length) await redis.del(cacheKeys);
    res.json({ ok: true, output: output.trim() });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/admin/k6', async (req, res) => {
  const { script = 'sprint-4-scale' } = req.body;
  if (k6State.running) {
    return res.status(409).json({ ok: false, error: 'A k6 run is already in progress' });
  }
  const valid = K6_SCRIPTS.find((s) => s.id === script);
  if (!valid) return res.status(400).json({ ok: false, error: 'Unknown script' });

  try {
    const { execId } = await execInContainer(
      HOLMES_CONTAINER,
      ['k6', 'run', `/workspace/k6/${script}.js`],
      true  // detached
    );
    k6State = { running: true, execId, script, startedAt: new Date().toISOString() };
    pollK6(execId);
    res.json({ ok: true, execId, script, startedAt: k6State.startedAt });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/admin/k6/status', (_req, res) => res.json(k6State));

app.get('/health', (_req, res) => res.json({ status: 'healthy', service: 'dashboard' }));

// ── Reset all data ────────────────────────────────────────────────────────────

const DATABASES = [
  { container: 'payment-db',          user: 'admin', db: 'payments' },
  { container: 'fraud-db',            user: 'fraud',  db: 'frauddb' },
  { container: 'analytics-db',        user: 'analytics', db: 'analytics_db' },
  { container: 'ticket-purchase-db',  user: 'user',  db: 'ticket-purchase-db' },
  { container: 'refund-db',           user: 'user',  db: 'refund_db' },
  { container: 'events-db',           user: 'user',  db: 'events-db' },
  { container: 'users-db',            user: 'user',  db: 'users-db' },
];

// Truncate all public tables in a postgres container
const TRUNCATE_SQL = `DO $$ DECLARE r RECORD; BEGIN FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE'; END LOOP; END $$;`;

app.post('/api/admin/reset', async (_req, res) => {
  const results = {};

  try {
    await redis.flushAll();
    results.redis = 'flushed';
  } catch (e) {
    results.redis = 'error: ' + e.message;
  }

  await Promise.all(DATABASES.map(async ({ container, user, db }) => {
    try {
      await execInContainer(container, ['psql', '-U', user, '-d', db, '-c', TRUNCATE_SQL]);
      results[container] = 'truncated';
    } catch (e) {
      results[container] = 'error: ' + e.message;
    }
  }));

  const anyError = Object.values(results).some(v => v.startsWith('error'));
  res.json({ ok: !anyError, results });
});

// ── Test runner (SSE) ─────────────────────────────────────────────────────────

const CARDS = [
  { cc: '4111111111111111', cardType: 'Visa',   expiry: '12/27', cvv: '123' },
  { cc: '5500005555555559', cardType: 'Master', expiry: '11/26', cvv: '456' },
  { cc: '4012888888881881', cardType: 'Visa',   expiry: '09/28', cvv: '321' },
];
const FRAUD_CARD = { cc: '4000000000000002', cardType: 'Visa', expiry: '12/27', cvv: '999' };

app.get('/api/test/run', async (req, res) => {
  const total    = Math.min(Math.max(parseInt(req.query.total    ?? 15), 1), 100);
  const validPct = Math.max(parseFloat(req.query.validPct  ?? 60), 0);
  const fraudPct = Math.max(parseFloat(req.query.fraudPct  ?? 20), 0);
  const delayMs  = Math.min(Math.max(parseInt(req.query.delayMs  ?? 300), 50), 5000);
  // remainder goes to waitlist

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  send({ type: 'start', total, validPct, fraudPct, delayMs });

  let events = [];
  try {
    const r = await fetch('http://event-catalog:3005/events?limit=20');
    const d = await r.json();
    events = Array.isArray(d) ? d : (d.events ?? []);
  } catch (e) {
    send({ type: 'error', message: 'Cannot reach event-catalog: ' + e.message });
    res.end();
    return;
  }

  if (!events.length) {
    send({ type: 'error', message: 'No events found — use the Events page to seed the catalog first' });
    res.end();
    return;
  }

  const stats = { success: 0, fraud: 0, waitlist: 0, failed: 0, total };

  for (let i = 0; i < total; i++) {
    if (res.destroyed) break;

    const rand = Math.random() * 100;
    const event = events[Math.floor(Math.random() * events.length)];

    let reqType, seats, paymentInfo;
    if (rand < validPct) {
      reqType = 'valid';
      seats = Math.floor(Math.random() * 3) + 1;
      paymentInfo = CARDS[Math.floor(Math.random() * CARDS.length)];
    } else if (rand < validPct + fraudPct) {
      reqType = 'fraud';
      seats = 7;  // exceeds FRAUD_MAX_SEATS_THRESHOLD=6
      paymentInfo = FRAUD_CARD;
    } else {
      reqType = 'waitlist';
      seats = 9999;  // guaranteed oversell
      paymentInfo = CARDS[0];
    }

    const idemKey = randomUUID();
    const t0 = Date.now();

    send({ type: 'request', i: i + 1, total, reqType, eventName: event.name ?? event.title ?? String(event.id), eventId: event.id, seats });

    try {
      const pr = await fetch('http://ticket-purchase:3000/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, seats, paymentInfo, idemKey }),
      });
      const body = await pr.json().catch(() => ({}));
      const latency = Date.now() - t0;
      const status = pr.status;

      if (status === 200)      { stats.success++; }
      else if (status === 409) { stats.waitlist++; }
      else                     { stats.failed++; }
      if (reqType === 'fraud' && status === 200) stats.fraud++;

      send({ type: 'result', i: i + 1, reqType, status, body, latency, stats: { ...stats } });
    } catch (e) {
      stats.failed++;
      send({ type: 'result', i: i + 1, reqType, status: 0, error: e.message, latency: Date.now() - t0, stats: { ...stats } });
    }

    if (i < total - 1) await new Promise(r => setTimeout(r, delayMs));
  }

  send({ type: 'done', stats });
  res.end();
});

app.listen(PORT, () => console.log(`Dashboard running on port ${PORT}`));
