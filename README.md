# Super Good Ticketing System — System 1: Event Ticketing Platform

**Course:** COMPSCI 426  
**Team:** Ian Mei, Ethan Pham, Jasper McCormack, Henry Braham, Rikhav Shah, Erika Lam, James Rust, Jonathan Zhang  
**System:** Event Ticketing   
**Repository:** [\[GitHub URL — public fork of https://github.com/umass-cs-426/starter-project\]](https://github.com/RikShah04/Super_Good_Ticketing_System)

---

## Team and Service Ownership

| Team Member | Files / Directories Owned This Sprint |
| ----------- | ----------------------------------------------- |
| Ian Mei | `ticket-purchase/`, `event-catalog`, `k6/` |
| Ethan Pham | `ticket-purchase/`, `k6/` |
| Jasper McCormack | `event-catalog/`, `users/` |
| Henry Branham | `payment/` |
| Rikhav Shah | `notification/`, `waitlist/`, `/k6` |
| Erika Lam | `refund/`, `k6/` |
| James Rust | `fraud-detection/`, `Caddyfile` |
| Jonathan Zhang | `analytics/` |

> Ownership is verified by `git log --author`. Each person must have meaningful commits in the directories they claim.

---

## How to Start the System

```bash
# Start everything (builds images on first run)
docker compose up --build

# Start with service replicas (Sprint 4)
docker compose up --scale ticket-purchase=3 event-catalog=3 payment=3

# Verify all services are healthy
docker compose ps

# Stream logs
docker compose logs -f

# Open a shell in the holmes investigation container
docker compose exec holmes bash
```

### Base URLs (development, all from holmes)

```
event-catalog      http://event-catalog:3005        service
ticket-purchase    http://ticket-purchase:3000      service
payment            http://payment:3000              service
refund             http://refund:3001               service
users              http://users:3006                service
waitlist           http://waitlist:3000             worker
fraud-worker       http://fraud-worker:3000         worker
analytics          http://analytics:3000            worker
notification       http://notification:3000         worker
redis              (no port)
holmes             (no port, access via exec)
```

> From inside holmes, services are reachable by name:
> `curl http://your-service:3000/health`
>
> See [holmes/README.md](holmes/README.md) for a full tool reference.

---

## System Overview

The Super Good Ticketing System is a microservice-based event ticketing platform where users can browse events, purchase tickets, and refund previous orders. The system is composed of multiple services and workers that all communicate over Redis or HTTP calls. Some services and workers also own their own database.

Upon purchasing a ticket, an order is logged in `ticket-purchase-db`. The event details are gathered from `event-catalog`, and if the event is out of seats, the order is pushed to `waitlist`. Otherwise, a payment is sent to `payment` for processing. The endpoint will retry payments 3 times before returning a failure to the request sender. On success, jobs are pushed to queues for `fraud-worker` and `analytics` to process, as well as a pub/sub channel that `notifications` listens on.

Upon refunding a ticket, a refund is logged to `refund-db`. The original purchase details are gathered from `ticket-purchase` and the refund is sent to `payment` to fulfill. Upon success, `ticket-purchase` is queried again to update its own purchase data, and a message is pushed to `notifications`' and `waitlist`'s pub/sub channels for processing. `waitlist` will promote a waitlisted order to `ticket-purchase` to re-attempt a purchase when a seat is released by `refund`.

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

### POST /purchase

```
POST /purchase

  Accepts order details and coordinates a purchase with the other services.

  Responses:
    200  Purchase completed successfully
    400  Missing or invalid request body or data
    404  Event not found
    409  Not enough seats available for order
    500  Unexpected server error
```

**Example request:**

```bash
curl \
  -H 'Content-type: application/json' \
  -d '{
    "eventId": "1654b713-a1d7-479d-85a9-4ecaddbdba9c",
    "seats": 2,
    "idemKey": "idem-1",
    "paymentInfo": {
      "cc": "1111111111111111",
      "cvv": "111",
      "expiry": "11/11",
      "cardType": "Visa"
    }
  }' http://localhost:3000/purchase
```

**Example response (200):**

```json
{
  "message": "Purchase successful",
  "purchaseId": 1
}
```

**Example response (400):**

```json
{
  "message": "Invalid payment data"
}
```

**Example response (404):**

```json
{
  "message": "Event not found"
}
```

### POST /verify

```
POST /verify

  For the refund service. Validates a provided purchaseId and seats.

  Responses:
    200  ID validated successfully
    400  Not enough refundable seats available for refund
    404  Purchase not found
    500  Unexpected server error
```

**Example request:**

```bash
curl \
  -H 'Content-type: application/json' \
  -d '{
    "purchaseId": 1,
    "seats": 1
  }' http://localhost:3000/verify
```

**Example response (200):**

```json
{
  "id": 1,
  "event_id": "1654b713-a1d7-479d-85a9-4ecaddbdba9c",
  "payment_id": "3634242b-7835-4106-9598-3637f95b81f6",
  "purchased_seats": 2,
  "refundable_seats": 2,
  "charge": "100.00",
  "status": "success",
  "reason": null,
  "created_at": "2026-04-28T...",
  "updated_at": "2026-04-28T...",
  "seats": 1
}
```

**Example response (400):**

```json
{
  "message": "Not enough seats available"
}
```

**Example response (404):**

```json
{
  "message": "Purchase not found"
}
```

### POST /refund

```
POST /refund

  For the refund service. Confirms a previously validated refund.

  Responses:
    200  Refund processed successfully
    400  Refund request expired or invalid
    500  Unexpected server error
```

**Example request:**

```bash
curl \
  -H 'Content-type: application/json' \
  -d '{
    "purchaseId": 1
  }' http://localhost:3000/refund
```

**Example response (200):**

```json
{
  "message": "Refund successful",
  "refundedSeats": 1
}
```

**Example response (400):**

```json
{
  "message": "Refund request expired or invalid"
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

### GET /events/:id
```
GET /events/:id

  Returns details for a single event. Served from the Redis cache when available; a cache miss falls through to the database.

  Path:
    id  string (UUID) The event's ID

  Responses:
    200 Success - returns event detail
    400 Invalid ID format
    404 No event found with that ID
    503 Database or Redis unavailable
```

**Example request:**

```bash
curl http://event-catalog:3005/events/fb9220d9-b0fd-4322-8486-492457c38909
```

**Example response (200):**
```json
{
  "id": "fb9220d9-b0fd-4322-8486-492457c38909",
  "name": "Wintheiser World Tour",
  "venue": "North Bryan Amphitheater",
  "eventdate": "2026-01-21T00:00:00.000Z",
  "totalseats": 3870,
  "availableseats": 3870,
  "priceusd": "274.16"
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
docker compose exec holmes curl http://payment:3001/health
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

### POST /process

```
POST /process

   Processes payment by validating input, simulating work, and storing payment token in database

  Example Payload:
  {
    "cc": "3790123453827313",
    "cvv": "123",
    "expiry": "10/27",
    "cardType": "Visa",
    "price": 100.00
  }

  Responses:
    200  Payment processed successfully
    400  Input validation failed (invalid cc, cvv, expiry, card type, etc.)
    500  Server error occured trying to process payment
```

**Example request:**

```bash
docker compose exec holmes
```

```bash
curl -X POST http://payment:3001/process
-H "Content-Type: application/json"
-d '{"cc":"3790123453827313","cvv":"123","expiry":"10/27","cardType":"Visa","price":100.00}'
```

**Example response (200):**

```json
{
  "status": "success",
  "paymentID": "3f8a7c2e-91d4-4b6f-a9c1-5e2d7f8a1b3c",
  "paymentToken": "tok_HSDK4398fDHSDDUSHF48934DKHS",
  "timestamp": "2026-04-14T04:27:03.050Z",
}
```

**Example response (400):**

```json
{
  "status": "failure",
  "error": "Invalid CC",
  "timestamp": "2026-04-14T04:27:03.050Z",
}
```

**Example response (500):**

```json
{
  "status": "failure",
  "error": "A server error occured when attempting to process payment",
  "timestamp": "2026-04-14T04:27:03.050Z",
}
```

### POST /refund

```
POST /refund

   Processes payment refund by updating database to reflect refund amount and handles partial/full refunds

  Example Payload:
  {
    "paymentID": "3f8a7c2e-91d4-4b6f-a9c1-5e2d7f8a1b3c",
    "price": 100.00
  }

  Responses:
    200  Payment refunded successfully (partially or full)
    400  Input validation failed (invalid payment ID, refund amount is greater than original payment, etc.)
    500  Server error occured trying to process payment
```

**Example request:**

```bash
docker compose exec holmes
```

```bash
curl -X POST http://payment:3001/refund
-H "Content-Type: application/json"
-d '{"paymentID":"3f8a7c2e-91d4-4b6f-a9c1-5e2d7f8a1b3c","amount":50.00}'
```

**Example response (200):**

```json
{
  "status": "partial_refund",
  "paymentID": "3f8a7c2e-91d4-4b6f-a9c1-5e2d7f8a1b3c",
  "timestamp": "2026-04-14T04:27:03.050Z",
}
```

**Example response (400):**

```json
{
  "status": "failure",
  "error": "Payment ID Not Found",
  "timestamp": "2026-04-14T04:27:03.050Z",
}
```

**Example response (500):**

```json
{
  "status": "failure",
  "error": "A server error occured when attempting to process payment",
  "timestamp": "2026-04-14T04:27:03.050Z",
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

## Users

### GET /health

```
GET /health

  Returns the health status of the users service, including:
    - database connectivity
  
  Responses
    200 Service is healthy
    503 Service is unhealthy (one or more dependencies failing)
```

**Example Request**

```bash
  docker compose exec holmes curl http://users:3006/health
```

**Example Response(200)**

```json
{
  "status": "healthy",
  "service": "users",
  "timestamp": "2026-04-23T14:39:08.969Z",
  "database": {
    "status": "healthy",
    "latency_ms": 7
  }
}
```

### GET /users

```
GET /user

  Returns a list of users. Served initially from the Redis cache when available; the cache is populated on first read and expires after 60s.

  Query:
    limit integer optional  default=5   Number of users returned

  Responses:
    200   Success — returns list of users
    503   Database or Redis unavailable
```

**Example request:**

```bash
curl http://users:3006/users?limit=10
```

**Example response (200):**

```json
{
  "limit":10,
  "users":
  [
    {
      "userid":"168b7f42-3584-4db4-bc9a-f3eb3e734bf3",
      "name":"Gwen Marvin",
      "email":"Jay.McKenzie-Volkman@gmail.com",
      "created_at":"2024-07-20T00:49:46.117Z"
    },
    {"userid":"dbf68d4b-9944-4e08-bb28-ece692d21d5b","name":"Ms. Destinee Luettgen","email":"Gerson_Rath61@yahoo.com","created_at":"2024-10-14T17:48:30.724Z"},
    {"userid":"f21caa51-b88b-4fbe-b6eb-58317fd0f72e","name":"Darrion Wintheiser","email":"Harmon6@hotmail.com","created_at":"2024-09-27T11:39:20.654Z"},
    {"userid":"24a9cf06-715e-43e6-a087-8455f5882f89","name":"Glennie Wisozk PhD","email":"Guy55@yahoo.com","created_at":"2024-06-12T10:15:25.049Z"},
    {"userid":"67b54f54-fb5a-496c-8ab4-a7ec87ddf7d1","name":"Caleb Parisian","email":"Aiden_Dickinson@hotmail.com","created_at":"2026-03-07T04:48:24.033Z"},
    {"userid":"1b1a9e9f-ebda-429f-a1e9-7721840fc0be","name":"Henrietta Dach","email":"Leo26@yahoo.com","created_at":"2025-10-20T21:18:48.460Z"},
    {"userid":"c642e6d2-c10f-417e-bd79-a1446445672c","name":"Muriel Barton","email":"Nash_Feeney32@gmail.com","created_at":"2024-10-13T08:25:40.921Z"},
    {"userid":"6d737745-6d4e-4020-8c19-c71d31c0966c","name":"Sherwood Cronin","email":"Devin43@hotmail.com","created_at":"2024-11-06T22:19:08.337Z"},
    {"userid":"89ef6975-a486-4aac-8e88-14c8cdea040b","name":"Jose Muller","email":"Tommy.Stehr14@hotmail.com","created_at":"2024-12-09T04:38:06.585Z"},
    {"userid":"c57a0396-bae5-4700-893c-ec7e163495a8","name":"Adolfo Baumbach","email":"Vicki_Lakin@hotmail.com","created_at":"2025-07-31T04:35:12.684Z"}
  ]
}
```

### GET /users/:id
```
GET /users/:id

  Returns information for a single user. Served from the Redis cache when available; a cache miss falls through to the database.

  Path:
    id  string (UUID) The user's ID

  Responses:
    200 Success - returns user info
    400 Invalid ID format
    404 No user found with that ID
    503 Database or Redis unavailable
```

**Example request:**

```bash
curl http://users:3006/users/2e33a6d5-646c-49b6-b995-68d4bc3a9d21
```

**Example response (200):**
```json
{
  "userid": "2e33a6d5-646c-49b6-b995-68d4bc3a9d21",
  "name": "Vaughn Bergstrom",
  "email": "Wayne_Effertz@hotmail.com",
  "created_at": "2024-12-13T06:39:26.878Z"
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
