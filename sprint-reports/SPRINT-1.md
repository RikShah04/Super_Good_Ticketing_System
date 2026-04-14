# Sprint 1 Report — Super_Good_Ticketing_System

**Sprint:** 1 — Foundation  
**Tag:** `sprint-1`  
**Submitted:** 04/14/26

---

## What We Built

In Sprint 1, we implemented the foundational infrastructure for our microservice-based ticketing system. All services are containerized using Docker and orchestrated with Docker Compose on a shared network.

Running `docker compose up --build` starts all services, including PostgreSQL databases, Redis, and multiple application services. Each service exposes a `/health` endpoint that reports dependency status and internal metrics.

---

## Individual Contributions

| Team Member | What They Delivered                                     | Key Commits            |
| ----------- | ------------------------------------------------------- | ---------------------- |
| James Rust      | fraud detection worker, health endpoints, connection to redis + postgres db    | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/14#issue-4258814131 |
| Erika Lam      | refund worker, health endpoints, connection to redis + postgres, refund db schema, seat-released stub endpoint,  |                        |
| Rikhav Shah | notification service, connection to redis, health endpoint | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/13|
| Jonathan Zhang | analytics worker setup, health endpoint, db setup, compose | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/19 |
| Henry Branham | payment service, /health, postgres setup | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/21, https://github.com/RikShah04/Super_Good_Ticketing_System/pull/22 |
| Ethan Pham | ticket-purchase service, waitlist worker, /health endpoints, postgres setup, redis setup | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/4, https://github.com/RikShah04/Super_Good_Ticketing_System/pull/6 |

Verify with:

```bash
git log --author="Name" --oneline -- path/to/directory/
```

---

## What Is Working

- [ ] `docker compose up` starts all services without errors
- [ ] `docker compose ps` shows every service as `(healthy)`
- [ ] `GET /health` on every service returns `200` with DB and Redis status
- [ ] At least one synchronous service-to-service call works end-to-end
- [ ] k6 baseline test runs successfully

---

## What Is Not Working / Cut

[Be honest. What did you not finish? What did you cut from the sprint plan and why? How will you address it in Sprint 2?]

---

## k6 Baseline Results

Script: `k6/sprint-1.js`  
Run: `docker compose exec holmes k6 run /workspace/k6/sprint-1.js`

```
[Paste the k6 summary output here]
```

| Metric             | Value |
| ------------------ | ----- |
| p50 response time  |       |
| p95 response time  |       |
| p99 response time  |       |
| Requests/sec (avg) |       |
| Error rate         |       |

These numbers are your baseline. Sprint 2 caching should improve them measurably.

---

## Blockers and Lessons Learned

One major challenge during this sprint was debugging Docker networking and service health issues. In particular, we encountered problems with port conflicts, incorrect service names, and Redis connection blocking due to improper client usage.

We learned the importance of using separate Redis clients for blocking operations (e.g., BRPOP) and non-blocking health checks. Without this separation, health endpoints could hang or fail unexpectedly.

Another lesson was the importance of consistent environment variable naming between Docker Compose and application code. Mismatches caused incorrect queue monitoring behavior.

Overall, careful debugging using logs and testing from the holmes container was essential in validating that services were correctly networked and functioning.
