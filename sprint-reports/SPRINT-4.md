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
| [Name]      | | |
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

| Metric | 1 replica | 3 replicas | Change |
| ------ | --------- | ---------- | ------ |
| p50    | | | |
| p95    | | | |
| p99    | | | |
| RPS    | | | |

[Explain the improvement. Which replica count started to show diminishing returns?]

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
