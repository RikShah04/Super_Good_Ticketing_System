# Sprint 4 Report — [Team Name]

**Sprint:** 4 — Replication, Scaling, and Polish  
**Tag:** `sprint-4`  
**Submitted:** [date, before 05.05 class]

---

## What We Built

[Which services are replicated? How does load balancing work? What polish work was completed?]

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Henry Branham      | added payment endpoints to README.md, added JSDoc annotations to payment service code | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/78 |
| Jonathan Zhang      | confirmed proper analytics schema, added internal endpts aggregate stats, edit docs | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/79 |
| Jasper McCormack | Corrected health endpoint errors | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/82 |
| James Rust      | Caddy load balancing for ticket purchase, payment, and event catalog services; added instance IDs to verify load is actually balancing | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/80 |
| Ethan Pham      | Wrote k6 scale test | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/81 |
| Rikhav Shah      | Wrote k6 replica test | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/83 |


---

## Starting the System with Replicas

```bash
docker compose up --scale [service-name]=3 --scale [other-service]=2
```

After startup:

```
[Paste docker compose ps output here showing all replicas as (healthy)]
```

---

## What Is Working

- [x] At least 3 services replicated via `--scale`
- [x] Load balancer distributes traffic across replicas (visible in logs)
- [x] Services are stateless — multiple instances run without conflicts
- [x] `docker compose ps` shows all replicas as `(healthy)`
- [x] System is fully complete for team size

---

## What Is Not Working / Cut

---

## k6 Results

### Test 1: Scaling Comparison (`k6/sprint-4-scale.js`)

| Metric | 1 replica   | 3 replicas  | Change      |
| ------ | ----------- | ----------- | ----------- |
| p50    | 2.60 ms     | 2.26 ms     | -0.34 ms    |
| p95    | 4.73 ms     | 3.43 ms     | -1.30 ms    |
| p99    | 7.05 ms     | 4.25 ms     | -2.80 ms    |
| RPS    | 52.22 req/s | 52.15 req/s | -0.07 req/s |

The test shows a noticable improvement at higher p-levels. We were able to improve response times by distributing the load across three replicas rather than one, such that requests do not have to wait as long to get a response back. Though most requests are processed roughly as fast, the others are handled more quickly now.

The requests-per-second metric stayed constant, showing that though response times improved, overall throughput remained steady. (This may be due to the endpoint that we are using to test. If we used an endpoint that requires more computation, like `ticket-purchase`'s /purchase or `refund`'s /refund, 1 replica may see fewer requests per second.)

### Test 2: Replica Failure (`k6/sprint-4-replica.js`)

Timeline:

| Time | Event |
| ---- | ----- |
| 0s   | k6 started, 3 replicas running |
| 19s | Killed replica: `docker stop [container-id]` |
| 34s | Surviving replicas absorbed traffic |
| 37s | Replica restarted: `docker compose up -d` |
| 70s | Traffic redistributed, back to normal |

```
BEFORE
time="2026-05-05T03:32:56Z" level=info msg="setup: catalog ok …" source=console
running (0m06.0s), 05/21 VUs, 39 complete …
running (0m14.0s), 10/21 VUs, 192 complete …
running (0m24.0s), 17/21 VUs, 526 complete …
running (0m32.0s), 21/21 VUs, 890 complete …
  ↑ 32s

DURING
running (0m33.0s), 21/21 VUs, 940 complete …
time="2026-05-05T03:33:30Z" level=warning msg="Request Failed" error="…/events?page=1&limit=20…: request timeout"
  ↑ annotate: ~34s after setup — first timeout
running (0m37.0s), 21/21 VUs, 1152 complete …
time="2026-05-05T03:33:33Z" level=warning msg="Request Failed" error="…request timeout"
  ↑ 37s
running (0m39.0s), 21/21 VUs, 1266 complete …

AFTER
running (1m00.0s), 21/21 VUs, 2437 complete …
running (1m10.0s), 02/21 VUs, 2765 complete …
  ↑ 70s
```

During failure — `docker compose ps`:

```
super_good_ticketing_system-event-catalog-1     super_good_ticketing_system-event-catalog     "docker-entrypoint.s…"   event-catalog        33 minutes ago   Up 33 minutes (healthy)               3005/tcp
super_good_ticketing_system-event-catalog-2     super_good_ticketing_system-event-catalog     "docker-entrypoint.s…"   event-catalog        33 minutes ago   Exited (0) About a minute ago        
super_good_ticketing_system-event-catalog-3     super_good_ticketing_system-event-catalog     "docker-entrypoint.s…"   event-catalog        33 minutes ago   Up 33 minutes (healthy)               3005/tcp
```

After restart — `docker compose ps`:

```
super_good_ticketing_system-event-catalog-1     super_good_ticketing_system-event-catalog     "docker-entrypoint.s…"   event-catalog        33 minutes ago   Up 33 minutes (healthy)     3005/tcp
super_good_ticketing_system-event-catalog-2     super_good_ticketing_system-event-catalog     "docker-entrypoint.s…"   event-catalog        33 minutes ago   Up 2 minutes (healthy)      3005/tcp
super_good_ticketing_system-event-catalog-3     super_good_ticketing_system-event-catalog     "docker-entrypoint.s…"   event-catalog        33 minutes ago   Up 33 minutes (healthy)     3005/tcp
```

---

## Blockers and Lessons Learned

We did not add much functionality for this sprint, but from this project as a whole, we learned how integral clear communication is when building a complex system. Every team member needs to understand how their piece fits into the larger puzzle, and by the end, every member of our team worked well together to complete the system.