# Sprint 2 Report — Super Good Ticketing System

**Sprint:** 2 — Async Pipelines and Caching  
**Tag:** `sprint-2`  
**Submitted:** 4/21/26

---

## What We Built

[What cache did you add? What queue and worker are running? What does the async pipeline do?]  
In event-catalog, the Redis cache is used for the GET /events endpoint and GET /events/:id endpoint to reduce repeated reads to the database.  
A sample data script has been implemented to automatically fill the events-db with fake data.  
The fraud worker and queue are running.

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| [Jasper McCormack]      | events-db sample data, GET /events endpoint, GET /events/:id endpoint | 4f1ae18f1dacc15a1fef8269c217ec544fdf8181, 04c3760eb6e8fb3c8552f1bedc373cf549574ee6, 28e3cc46ceb1bb5e42097226ae09ad730ed1409b |
| James Rust      | Implemented fraud detection worker service, Redis queue consumption (fraud:queue), fraud detection logic (price threshold, seat count, repeated card attempts), Postgres persistence (fraud_results table), Redis result publishing and caching, DLQ handling | 1eab8ac, 4ca410b |
| Ian Mei     | Added reserve seat endpoint, fetching events from database, updating seating, and saving it. Also updated the events endpoint. | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/34 |
| Rikhav Shah      | subscribed notification to purchase events, simulate emails throught console logs| https://github.com/RikShah04/Super_Good_Ticketing_System/pull/36 |
| Jonathan Zhang     | subscribed analytics to purchase events, define schema, add analytics to db | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/47 | 
---

## What Is Working

- [✓] Redis cache in use — repeated reads do not hit the database
- [ ] Async pipeline works end-to-end (message published → worker consumes → action taken)
- [ ] At least one write path is idempotent (same request twice produces same result)
- [x] Worker logs show pipeline activity in `docker compose logs`
- [x] Worker `GET /health` returns queue depth, DLQ depth, and last-job-at

---

## What Is Not Working / Cut

---

## k6 Results

### Test 1: Caching Comparison (`k6/sprint-2-cache.js`)

| Metric | Sprint 1 Baseline | Sprint 2 Cached | Change |
| ------ | ----------------- | --------------- | ------ |
| p50    | | | |
| p95    | | | |
| p99    | | | |
| RPS    | | | |

[Explain the improvement. If the numbers did not improve, explain why and what you did to diagnose it.]

### Test 2: Async Pipeline Burst (`k6/sprint-2-async.js`)

```
[Paste k6 summary output here]
```

Worker health during the burst (hit `/health` while k6 is running):

```json
[Paste an example health response showing non-zero queue depth]
```

Idempotency check: [Describe what you sent and what happened when you sent the same idempotency key twice.]

---

## Blockers and Lessons Learned

- Debugging distributed systems is more complex than single-service development; logging and health endpoints were critical for visibility.
- Small schema mismatches (e.g., field naming differences between services) can break the pipeline and require careful coordination across teams.