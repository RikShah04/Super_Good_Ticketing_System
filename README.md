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
| Jasper McCormack | `event-catalog/db/schema.sql`, `event-catalog/seedEvents.js` |
| Henry Branham | `payment/`, `k6/` |
| Rikhav Shah | `notification/` |
| Erika Lam | `refund/`, `refund/db/schema.sql` |
| James Rust | `fraud-detection/` |
| Jonathan Zhang | `analytics/`, `analytics/db/schema.sql` |

> Ownership is verified by `git log --author`. Each person must have meaningful commits in the directories they claim.

---

## How to Start the System

```bash
# Start everything (builds images on first run)
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
payment    http://payment:3000 (from holmes)
refund    http://refund:3001 (from holmes)
analytics    http://analytics:3000 (from holmes)
notification   http://notification:3000 (from holmes)
event-catalog   http://localhost:3005 (from holmes)
waitlist    http://waitlist:3000 (from holmes)

[worker-name]          http://localhost:[port]   (health endpoint only)
holmes                 (no port — access via exec)
```

> From inside holmes, services are reachable by name:
> `curl http://your-service:3000/health`
>
> See [holmes/README.md](holmes/README.md) for a full tool reference.

---

## System Overview

The Super Good Ticketing System is a microservice-based event ticketing platform where users can browse events, purchase tickets, and receive notifications. The system is composed of multiple services including ticket purchase, payment, notification, refund, analytics, and fraud detection.

Services communicate using a combination of synchronous HTTP calls and asynchronous messaging via Redis. For example, the ticket-purchase service processes a purchase request and pushes a job to a Redis queue for downstream processing.

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

## Event Catalog Service

### GET /events

```
GET /events

  Returns a paginated list of events. Served initially from the Redis cache when available; the cache is populated on first read and expires after 60s.

  Query:
    page  integer optional  default=1   Page number, 1-indexed
    limit integer optional  default=20  Events per page, max 100
    venue string  optional  default=-   Filter by venue name, or partial match

  Responses:
    200   Success — returns list of events
    503   Database or Redis unavailable
```

**Example request:**

```bash
curl "http://event-catalog:3005/events?page=1&limit=3"
```

**Example response (200):**

```json
{
  "page": 1,
  "limit": 3,
  "total": 50,
  "events": [
    {
      "id": "1654b713-a1d7-479d-85a9-4ecaddbdba9c",
      "name": "Barrows World Tour",
      "venue": "West Rolandohaven Stadium",
      "eventdate": "2026-01-04T00:00:00.000Z",
      "totalseats": 5598,
      "availableseats": 5598,
      "priceusd": "96.80"
    },
    {
      "id": "5accc6d1-8055-46b6-9735-319a976d8705",
      "name": "Lesch Live",
      "venue": "Wilkinsontown Arena",
      "eventdate": "2026-01-05T00:00:00.000Z",
      "totalseats": 4160,
      "availableseats": 4160,
      "priceusd": "199.53"
    },
    {
      "id": "296fdd76-40dd-4ff8-bcfd-372f93a951a8",
      "name": "Lueilwitz Live",
      "venue": "Homestead Arena",
      "eventdate": "2026-01-18T00:00:00.000Z",
      "totalseats": 9876,
      "availableseats": 9876,
      "priceusd": "230.22"
    }
  ]
}
```

### GET /health

```
GET /health

  Checks the status of Redis and the events-db. Returns a successful response from event-catalog if both are healthy, including the name of the service, a status, the time of response, and the status information of both Redis and the db. 

  Responses:
    200 Success - returns JSON object with healthy status and timestamp
    503 One or more dependencies are unreachable
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
"timestamp": "2026-04-16T22:50:50.895Z",
"redis": {
  "status": "healthy",
  "latency_ms": 0
},
"database": {
  "status": "healthy",
  "latency_ms": 0
}
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

## Refund Worker

### GET /health

```
GET /health

   Returns the current health status of the refund worker, including:
    - Redis connectivity
    - database connectivity

  Responses:
    200  Service is healthy (all required dependencies reachable)
    503  Service is unhealthy (one or more dependencies failing)
```

**Example request:**

```bash
docker compose exec holmes curl http://notification:3001/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "refund",
  "timestamp": "2026-04-14T14:27:11.343Z",
  "uptime_seconds": 175,
  "checks": {
    "redis": {
      "status": "healthy",
      "latency_ms": 3
    },
    "database": {
      "status": "healthy",
      "latency_ms": 63
    },
  }
}
```

**Example response (503):**

```json
{
  "status": "unhealthy",
  "service": "refund",
  "timestamp": "2026-04-14T04:26:03.396Z",
  "uptime_seconds": 512,
  "checks": {
    "redis": {
      "status": "unhealthy",
      "latency_ms": 3
    },
    "database": {
      "status": "unhealthy",
      "latency_ms": 63
    },
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
