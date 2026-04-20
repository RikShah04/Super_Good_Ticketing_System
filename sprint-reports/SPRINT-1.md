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
| Erika Lam      | refund worker, health endpoints, connection to redis + postgres, refund db schema, seat-released stub endpoint,  |  https://github.com/RikShah04/Super_Good_Ticketing_System/pull/11 |
| Rikhav Shah | notification service, connection to redis, health endpoint | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/13|
| Jonathan Zhang | analytics worker setup, health endpoint, db setup, compose | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/19 |
| Henry Branham | payment service, /health, postgres setup | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/21, https://github.com/RikShah04/Super_Good_Ticketing_System/pull/22 |
| Ethan Pham | ticket-purchase service, waitlist worker, /health endpoints, postgres setup, redis setup | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/4, https://github.com/RikShah04/Super_Good_Ticketing_System/pull/6 |
| Ian Mei | ticket-purchase event db schema, bug fix with initializing redis | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/17, https://github.com/RikShah04/Super_Good_Ticketing_System/pull/16 |

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

Moving foward, we want to work on contributing in a timely manner so that tasks that depend on others are not also pushed back. We will communicate more openly and proactively with each other to ensure that each person is aware of what tasks they have to accomplish and what other work depends on theirs.

---

## k6 Baseline Results

Script: `k6/sprint-1.js`  
Run: `docker compose exec holmes k6 run /workspace/k6/sprint-1.js`

```
    checks_total.......: 3994    56.723811/s
    checks_succeeded...: 100.00% 3994 out of 3994
    checks_failed......: 0.00%   0 out of 3994

    ✓ status is 200
    ✓ response time < 500ms

    CUSTOM
    errors.........................: 0.00%  0 out of 1997

    HTTP
    http_req_duration..............: avg=3.47ms   min=245.5µs  med=3.45ms   max=31.91ms  p(90)=5.24ms  p(95)=6.02ms  
      { expected_response:true }...: avg=3.47ms   min=245.5µs  med=3.45ms   max=31.91ms  p(90)=5.24ms  p(95)=6.02ms  
    http_req_failed................: 0.00%  0 out of 1997
    http_reqs......................: 1997   28.361906/s

    EXECUTION
    iteration_duration.............: avg=505.67ms min=500.63ms med=505.45ms max=534.78ms p(90)=508.6ms p(95)=509.89ms
    iterations.....................: 1997   28.361906/s
    vus............................: 1      min=1         max=20
    vus_max........................: 20     min=20        max=20

    NETWORK
    data_received..................: 469 kB 6.7 kB/s
    data_sent......................: 184 kB 2.6 kB/s
```

| Metric             | Value |
| ------------------ | ----- |
| p50 response time  |   3.45ms  |
| p95 response time  |   6.02ms  |
| p99 response time  |   8.6ms   |
| Requests/sec (avg) |   28.36   |
| Error rate         |     0%    |

These numbers are your baseline. Sprint 2 caching should improve them measurably.

---

## Blockers and Lessons Learned

One major challenge during this sprint was debugging Docker networking and service health issues. In particular, we encountered problems with port conflicts, incorrect service names, and Redis connection blocking due to improper client usage.

We learned the importance of using separate Redis clients for blocking operations (e.g., BRPOP) and non-blocking health checks. Without this separation, health endpoints could hang or fail unexpectedly.

Another lesson was the importance of consistent environment variable naming between Docker Compose and application code. Mismatches caused incorrect queue monitoring behavior.

Overall, careful debugging using logs and testing from the holmes container was essential in validating that services were correctly networked and functioning.
