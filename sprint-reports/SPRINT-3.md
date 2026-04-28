# Sprint 3 Report — Super Good Ticketing System

**Sprint:** 3 — Reliability and Poison Pills  
**Tag:** `sprint-3`  
**Submitted:** 4/28/26

---

## What We Built

[What failure scenarios does the system now handle? Which queues have DLQ handling? What happens when a poison pill is injected?]

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Henry Branham      | added payment refund endpoint, takes in paymentID and amount setting status to refunded or partial_refund in db | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/48, https://github.com/RikShah04/Super_Good_Ticketing_System/pull/61 |
| James Rust      | added retry logic to fraud detection DLQ, added a call to refund service on suspicious activity, added caddy load balancing |https://github.com/RikShah04/Super_Good_Ticketing_System/pull/64, https://github.com/RikShah04/Super_Good_Ticketing_System/pull/69, https://github.com/RikShah04/Super_Good_Ticketing_System/pull/65 |
| [Name]      | | |
| Jonathan Zhang      | add userId, handle browse events, handle refund events, change analytics to 3 loop async architecture | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/71 |
| Erika Lam      | refund flow (idempotent), verify purchase, payment refund endpoint, unreserve seats, DB storage, publish events | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/60 |
| [Name]      | | |
| Rikhav Shah      | set up waitlist functionality, added idempotency, added dlq | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/72 |
| Ian Mei      | Added an unreserve endpoint to event-catalog, did poison pill k6 testing| https://github.com/RikShah04/Super_Good_Ticketing_System/pull/50, https://github.com/RikShah04/Super_Good_Ticketing_System/pull/73|

---

## What Is Working

- [x] Poison pill handling: malformed messages go to DLQ, worker keeps running
- [x] Worker `GET /health` shows non-zero `dlq_depth` after poison pills are injected
- [x] Worker status remains `healthy` while DLQ fills
- [x] System handles failure scenarios gracefully (no dangling state, no crash loops)
- [x] All services/workers required for team size are implemented

---

## What Is Not Working / Cut

---

## Poison Pill Demonstration

How to inject a poison pill:

```bash
# From inside holmes:
docker compose exec holmes bash

# Example — publish a malformed message directly to the queue:
redis-cli -h redis RPUSH your-queue '{"this": "is malformed"}'
```

Worker health before injection:

```json
{
  "status": "healthy",
  "queue_depth": 0,
  "dlq_depth": 0,
  "last_job_at": "2025-04-24T..."
}
```

Worker health after injection:

```json
{
  "status": "healthy",
  "queue_depth": 0,
  "dlq_depth": 3,
  "last_job_at": "2025-04-24T..."
}
```

---

## k6 Results: Poison Pill Resilience (`k6/sprint-3-poison.js`)

```
█ THRESHOLDS 

    dlq_depth
    ✓ 'max>0' max=146

    dlq_growth_events
    ✓ 'count>0' count=22

    http_req_duration{type:valid}
    ✓ 'p(95)<3000' p(95)=2.08s

    valid_errors
    ✓ 'rate<0.1' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 774     10.955881/s
    checks_succeeded...: 100.00% 774 out of 774
    checks_failed......: 0.00%   0 out of 774

    ✓ worker health endpoint reachable
    ✓ worker not crashed
    ✓ valid: completed successfully
    ✓ valid: not a server error
    ✓ poison: accepted for async processing

    CUSTOM
    dlq_depth......................: avg=100.208333 min=70     med=94    max=146   p(90)=137.5 p(95)=143.25
    dlq_growth_events..............: 22     0.311407/s
    valid_errors...................: 0.00%  0 out of 324

    HTTP
    http_req_duration..............: avg=1.87s      min=2.66ms med=2.03s max=2.35s p(90)=2.06s p(95)=2.08s 
      { expected_response:true }...: avg=1.87s      min=2.66ms med=2.03s max=2.35s p(90)=2.06s p(95)=2.08s 
      { type:valid }...............: avg=1.99s      min=1.24s  med=2.03s max=2.35s p(90)=2.06s p(95)=2.08s 
    http_req_failed................: 0.00%  0 out of 427
    http_reqs......................: 427    6.044136/s

    EXECUTION
    iteration_duration.............: avg=2.57s      min=2.52s  med=2.54s max=3.01s p(90)=2.6s  p(95)=3s    
    iterations.....................: 426    6.029981/s
    vus............................: 1      min=1        max=21
    vus_max........................: 21     min=21       max=21

    NETWORK
    data_received..................: 130 kB 1.8 kB/s
    data_sent......................: 129 kB 1.8 kB/s




running (1m10.6s), 00/21 VUs, 426 complete and 0 interrupted iterations
health_poller ✓ [======================================] 1 VUs      1m10s
mixed_traffic ✓ [======================================] 00/20 VUs  1m10s
```

| Metric | Normal-only run | Mixed with poison pills | Change |
| ------ | --------------- | ----------------------- | ------ |
| p95 (valid requests) | ~2.0 s (payment service floor) | 2.08 s | +0.08 s (+4%) |
| Valid RPS | ~4.6 req/s | 4.6 req/s (324 reqs / 70 s) | 0% |
| Error rate | 0% | 0.00% (0 / 324 valid reqs) | 0% |

Throughput held steady throughout the test. Valid requests completed at the same ~4.6 req/s and with the same latency profile whether or not poison pills were in flight. The p95 of 2.08 s is essentially at the payment service's own 2-second simulated-work floor — the 80 ms of overhead is network and DB time, not contention from poison pill processing. All 774 checks passed (100%). The fraud worker remained healthy for the full 70 seconds: the `worker not crashed` check passed on every health poll while the DLQ simultaneously grew from 0 to 146 messages (22 observed increments). This confirms that the DLQ is absorbing malformed messages without affecting the worker's ability to process valid jobs.

---

## Blockers and Lessons Learned

Like in other sprints, clearly communicating about which information is sent to which service/worker was an important lesson that we continue to learn. Additionally, finalizing the flow of jobs (what order different services/workers interact) was difficult and required more discussion than in previous sprints.
