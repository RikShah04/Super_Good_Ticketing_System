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
ticket-purchase    http://ticket-purchase:3000 (from holmes)
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

### Ticket Purchase

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
curl http://localhost:3000/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "ticket-purchase",
  "timestamp": "2026-04-14T14:22:03.618Z",
  "uptime_seconds": 8,
  "checks": {
    "database": {
      "status": "healthy",
      "latency_ms": 16
    },
    "redis": {
      "status": "healthy",
      "latency_ms": 1
    }
  }
}
```

**Example response (503):**

```json
{
  "status": "unhealthy",
  "service": "ticket-purchase",
  "timestamp": "2026-04-14T14:22:03.618Z",
  "uptime_seconds": 8,
  "checks": {
    "database": {
      "status": "unhealthy",
      "error": "connection refused"
    },
    "redis": {
      "status": "healthy",
      "latency_ms": 1
    }
  }
}
```

---

### Analytics Worker (analytics)

### GET /health

```
GET /health

  Returns analytics worker health and dependency checks.
  Checks Postgres and Redis as required checks.
  Also reports queue depth and worker activity as degraded/healthy signals.

  Responses:
    200  Required dependencies are healthy
    503  One or more required dependencies are unreachable
```

**Example request:**

```bash
# from inside holmes or another service container
curl -s http://analytics:3000/health | jq .
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "analytics-worker",
  "timestamp": "2026-04-14T20:00:00.000Z",
  "uptime_seconds": 123,
  "checks": {
    "database": { "status": "healthy", "latency_ms": 4 },
    "redis": { "status": "healthy", "latency_ms": 2 },
    "queue": { "status": "healthy", "depth": 0, "dlq_depth": 0 },
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
  "service": "analytics-worker",
  "timestamp": "2026-04-14T20:00:05.000Z",
  "uptime_seconds": 128,
  "checks": {
    "database": {
      "status": "unhealthy",
      "error": "connect ECONNREFUSED analytics-db:5432"
    },
    "redis": { "status": "healthy", "latency_ms": 2 },
    "queue": { "status": "unhealthy", "error": "The client is closed" },
    "worker": {
      "status": "healthy",
      "last_job_at": "never",
      "jobs_processed": 0,
      "seconds_since_last_job": null
    }
  }
}
```

---

<!-- Add the rest of your endpoints below. One ### section per endpoint. -->

### Event Catalog Service

### GET /events

```
GET /events

  Incomplete: will return a list of events upon correct implementation. Currently, returns an empty JSON object.

  Query:
    TBD

  Responses:
    200  Success — returns empty JSON object
```

**Example request:**

```bash
curl "http://event-catalog:3005/events"
```

**Current example response (200):**
```
{}
```

**Goal example response (200):**

```json
{
  "events": [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "name": "Castellan World Tour",
      "venue": "Portland Arena",
      "eventDate": "2025-08-15T20:00:00Z",
      "availableSeats": 312,
      "priceUsd": 89.99
    },
    {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "name": "Summer Festival",
      "venue": "Boston Common",
      "eventDate": "2025-07-04T18:00:00Z",
      "availableSeats": 4200,
      "priceUsd": 45.0
    },
    {
      "id": "066de609-b04a-4b30-b46c-32537c7f1f6e",
      "name": "Jazz Night Live",
      "venue": "New York Jazz Center",
      "eventDate": "2025-09-01T19:30:00Z",
      "availableSeats": 0,
      "priceUsd": 120.0
    }
  ]
}
```

### GET /health

```
GET /health

  Returns a successful response from event-catalog if healthy, including the name of the service, a status, and the time of response.

  Responses:
    200 Success - returns JSON object with healthy status and timestamp
```
**Example request:**

```bash
curl "http://event-catalog:3005/health"
```

**Example response:**

```json
{
  "status": "healthy",
  "service": "event-catalog",
  "timestamp": "2026-04-14T13:12:49.346Z"
}
```

## Notification Service

### GET /health

```
GET /health

   Returns the current health status of the notification service, including:
    - Redis connectivity

  Responses:
    200  Service is healthy (all required dependencies reachable)
    503  Service is unhealthy (one or more dependencies failing)
```

**Example request:**

```bash
docker compose exec holmes curl http://notification:3000/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "Notification Service",
  "timestamp": "2026-04-14T04:26:03.396Z",
  "uptime_seconds": 512,
  "checks": {
    "redis": {
    "status": "healthy",
    "latency_ms": 5
    }
  }
}
```

**Example response (503):**

```json
{
  "status": "unhealthy",
  "service": "Notification Service",
  "timestamp": "2026-04-14T04:26:03.396Z",
  "uptime_seconds": 512,
  "checks": {
    "redis": {
    "status": "unhealthy",
    "error": "connection refused"
    }
  }
}
```

---

### Payment Service

### GET /health

```
GET /health

   Returns the current health status of the payment service, including:
    - Postgres connectivity

  Responses:
    200  Service is healthy (all required dependencies reachable)
    503  Service is unhealthy (one or more dependencies failing)
```

**Example request:**

```bash
docker compose exec holmes curl http://payment:3000/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "payments",
  "timestamp": "2026-04-14T04:27:03.050Z",
  "uptime_seconds": 12,
  "checks": {
    "database": {
      "status": "healthy",
      "latency_ms": 2
    }
  }
}
```

**Example response (503):**

```json
{
  "status": "unhealthy",
  "service": "payments",
  "timestamp": "2026-04-14T04:27:03.050Z",
  "uptime_seconds": 20,
  "checks": {
    "payment-db": {
    "status": "unhealthy",
    "error": "connection refused"
    }
  }
}
```

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
