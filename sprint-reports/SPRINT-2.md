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

Script: k6/sprint-2-async.js
Run: docker compose exec holmes k6 run /workspace/k6/sprint-2-async.js

```
 execution: local
        script: /workspace/k6/sprint-2-async.js
        output: -

     scenarios: (100.00%) 1 scenario, 50 max VUs, 40s max duration (incl. graceful stop):
              * default: 50 looping VUs for 10s (gracefulStop: 30s)



  █ THRESHOLDS 

    errors
    ✓ 'rate<0.01' rate=0.00%

    http_req_duration
    ✓ 'p(95)<2000' p(95)=11.52ms


  █ TOTAL RESULTS 

    checks_total.......: 31052   3080.886783/s
    checks_succeeded...: 100.00% 31052 out of 31052
    checks_failed......: 0.00%   0 out of 31052

    ✓ status is expected
    ✓ response time < 2s
    ✓ duplicate returned expected status
    ✓ duplicate response has message
    ✓ worker health endpoint reachable
    ✓ worker reports queue depth
    ✓ worker reports jobs processed

    CUSTOM
    errors.........................: 0.00%  0 out of 13308

    HTTP
    http_req_duration..............: avg=4.06ms   min=250.45µs med=2.31ms   max=81.54ms  p(90)=8.44ms   p(95)=11.52ms 
      { expected_response:true }...: avg=2.07ms   min=250.45µs med=1.61ms   max=43.12ms  p(90)=3.64ms   p(95)=4.99ms  
    http_req_failed................: 66.66% 8872 out of 13308
    http_reqs......................: 13308  1320.38005/s

    EXECUTION
    iteration_duration.............: avg=113.37ms min=101.77ms med=109.23ms max=206.67ms p(90)=127.15ms p(95)=137.09ms
    iterations.....................: 4436   440.126683/s
    vus............................: 50     min=50            max=50
    vus_max........................: 50     min=50            max=50

    NETWORK
    data_received..................: 5.1 MB 507 kB/s
    data_sent......................: 3.1 MB 307 kB/s




running (10.1s), 00/50 VUs, 4436 complete and 0 interrupted iterations
default ✓ [======================================] 50 VUs  10s

```

Worker health during the burst (hit `/health` while k6 is running):

```json
{
  "status": "healthy",
  "service": "waitlist-worker",
  "checks": {
    "queue": { "depth": 0, "dlq_depth": 0 },
    "worker": {
      "last_job_at": "never",
      "jobs_processed": 0
    }
  }
}
```

The worker /health endpoint was reachable through the test and remained healthy, but the queue depth never moved from 0. The worker reported jobs_processed = 0 and last_job_at = "never". 

However, logs from the ticket-purchase service showed repeated messages such as “Job with idempotency key … is still processing
which confirms there is still asynchronously work actively happening since it does eventually switch to completed.



Idempotency check: 

How to est idempotency, each iteration sent:

a purchase request with a unique idemKey
a second request with the same idemKey

Observed behavior:

the first request processed normally
the second request was always detected as a duplicate
duplicate requests either returned a “still processing” response or replayed the previously stored result

This confirms that duplicate requests are not processed individually and separately, and that idempotency is behaving as described.  

---

## Blockers and Lessons Learned

- Debugging distributed systems is more complex than single-service development; logging and health endpoints were critical for visibility.
- Small schema mismatches (e.g., field naming differences between services) can break the pipeline and require careful coordination across teams.