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
| [Name]      | | |

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

- [ ] At least [N] services replicated via `--scale`
- [ ] Load balancer distributes traffic across replicas (visible in logs)
- [ ] Services are stateless — multiple instances run without conflicts
- [ ] `docker compose ps` shows all replicas as `(healthy)`
- [ ] System is fully complete for team size

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
| [t]s | Killed replica: `docker stop [container-id]` |
| [t]s | Surviving replicas absorbed traffic |
| [t]s | Replica restarted: `docker compose up -d` |
| [t]s | Traffic redistributed, back to normal |

```
[Paste k6 output showing before / during / after the failure — annotate with timestamps]
```

During failure — `docker compose ps`:

```
[Paste output showing stopped/unhealthy replica alongside healthy survivors]
```

After restart — `docker compose ps`:

```
[Paste output showing all replicas back to (healthy)]
```

---

## Blockers and Lessons Learned
