# Super Good Ticketing System — System 1: Event Ticketing Platform

**Course:** COMPSCI 426  
**Team:** Ian Mei, Ethan Pham, Jasper McCormack, Henry Braham, Rikhav Shah, Erika Lam, James Rust, Jonathan Zhang  
**System:** Event Ticketing   
**Repository:** [\[GitHub URL — public fork of https://github.com/umass-cs-426/starter-project\]](https://github.com/RikShah04/Super_Good_Ticketing_System)

---

## Team and Service Ownership

| Team Member | Files / Directories Owned This Sprint |
| ----------- | ----------------------------------------------- |
| Ian Mei, Ethan Pham | `ticket-purchase/`, `ticket-purchase/db/schema.sql`, `waitlist/` |
| Jasper McCormack | `event-catalog/`,`event-catalog/db/schema.sql` |
| Henry Branham | `payment/`, `k6/` |
| Rikhav Shah | `notification/` |
| Erika Lam | `refund/`, `refund/db/schema.sql` |
| James Rust | `fraud-detection/` |
| Jonathan Zhang | `analytics/`, `analytics/db/schema.sql` |

> Ownership is verified by `git log --author`. Each person must have meaningful commits in the directories they claim.

---

## How to Start the System

```bash
Start everything (builds images on first run)
docker compose up --build

# Start with service replicas (Sprint 4)
docker compose up --scale your-service=3

# Verify all services are healthy
docker compose ps

# Stream logs
docker compose logs -f

# Open a shell in the holmes investigation container
docker compose exec holmes bash
```

### Base URLs (development)

```
fraud-worker   http://localhost:3000 (from holmes)
[your-service-name]    http://localhost:[port]
[worker-name]          http://localhost:[port]   (health endpoint only)
holmes                 (no port — access via exec)
```

> From inside holmes, services are reachable by name:
> `curl http://your-service:3000/health`
>
> See [holmes/README.md](holmes/README.md) for a full tool reference.

---

## System Overview

[One paragraph describing what your system does and how the services interact.
Include which service calls which, what queues exist, and how data flows.]

The fraud detection worker is a background service that is responsible for consuming purchase events from a Redis queue, processing each event, tracking worker activity, and reporting system health. 

---

## API Reference

<!--
  Document every endpoint for every service.
  Follow the format described in the project documentation: compact code block notation, then an example curl and an example response. Add a level-2 heading per service, level-3 per endpoint.
-->

---

### [Service Name]

### GET /health

```
GET /health

  Returns the health status of this service and its dependencies.

  Responses:
    200  Service and all dependencies healthy
    503  One or more dependencies unreachable
```

**Example request:**

```bash
curl http://localhost:[port]/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "db": "ok",
  "redis": "ok"
}
```

**Example response (503):**

```json
{
  "status": "unhealthy",
  "db": "ok",
  "redis": "error: connection refused"
}
```

---

<!-- Add the rest of your endpoints below. One ### section per endpoint. -->

## fraud-worker

### GET /health
 ```
 GET /health

   Returns the current health status of the fraud worker, including:
    - database connectivity
    - Redis connectivity
    - queue depth and DLQ depth
    - worker activity metrics (jobs processed, last job timestamp)

  Responses:
    200  Service is healthy (all required dependencies reachable)
    503  Service is unhealthy (one or more dependencies failing)
```
**Example request:**

```bash
docker compose exec holmes curl http://fraud-worker:3000/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "fraud-worker",
  "timestamp": "2026-04-13T21:17:13.813Z",
  "uptime_seconds": 18,
  "checks": {
    "database": {
      "status": "healthy",
      "latency_ms": 2
    },
    "redis": {
      "status": "healthy",
      "latency_ms": 1
    },
    "queue": {
      "status": "healthy",
      "depth": 0,
      "dlq_depth": 0
    },
    "worker": {
      "status": "healthy",
      "last_job_at": "never",
      "jobs_processed": 0,
      "seconds_since_last_job": null
    }
  }
}
```
**Example response (503):**

```json
{
  "status": "unhealthy",
  "service": "fraud-worker",
  "timestamp": "2026-04-13T21:25:42.102Z",
  "uptime_seconds": 45,
  "checks": {
    "database": {
      "status": "unhealthy",
      "error": "connect ECONNREFUSED"
    },
    "redis": {
      "status": "healthy",
      "latency_ms": 1
    },
    "queue": {
      "status": "unhealthy",
      "error": "Failed to read queue"
    },
    "worker": {
      "status": "degraded",
      "last_job_at": "2026-04-13T21:24:58.000Z",
      "jobs_processed": 3,
      "seconds_since_last_job": 44
    }
  }
}
```

---

## Sprint History

| Sprint | Tag        | Plan                                              | Report                                    |
| ------ | ---------- | ------------------------------------------------- | ----------------------------------------- |
| 1      | `sprint-1` | [SPRINT-1-PLAN.md](sprint-plans/SPRINT-1-PLAN.md) | [SPRINT-1.md](sprint-reports/SPRINT-1.md) |
| 2      | `sprint-2` | [SPRINT-2-PLAN.md](sprint-plans/SPRINT-2-PLAN.md) | [SPRINT-2.md](sprint-reports/SPRINT-2.md) |
| 3      | `sprint-3` | [SPRINT-3-PLAN.md](sprint-plans/SPRINT-3-PLAN.md) | [SPRINT-3.md](sprint-reports/SPRINT-3.md) |
| 4      | `sprint-4` | [SPRINT-4-PLAN.md](sprint-plans/SPRINT-4-PLAN.md) | [SPRINT-4.md](sprint-reports/SPRINT-4.md) |
