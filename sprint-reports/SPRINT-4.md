# Sprint 4 Report — Super Good Ticketing System

**Sprint:** 4 — Replication, Scaling, and Polish  
**Tag:** `sprint-4`  
**Submitted:** 05/05

---

## What We Built

Some systems were returning unhealthy even if they were fully functional, and these errors were fixed. We also implemented round-robin Caddy load balancing, allowing us to start the system up with `--scale`. `ticket-purchase`, `event-catalog`, and `payments` are replicated. 

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
| Erika Lam      | clean up refund code | https://github.com/RikShah04/Super_Good_Ticketing_System/pull/76 |
| Ian Mei| Testing Pull Requests | N/A

---

## Starting the System with Replicas

```bash
docker compose up --scale ticket-purchase=3 --scale event-catalog=3 --scale payment=3
```

After startup:

```
NAME                                            IMAGE                                         COMMAND                  SERVICE              CREATED          STATUS                    PORTS
analytics                                       super_good_ticketing_system-analytics         "docker-entrypoint.s…"   analytics            45 seconds ago   Up 42 seconds (healthy)   3000/tcp
analytics-db                                    postgres:16                                   "docker-entrypoint.s…"   analytics-db         8 minutes ago    Up 8 minutes (healthy)    5432/tcp
events-db                                       postgres:16                                   "docker-entrypoint.s…"   events-db            8 minutes ago    Up 8 minutes (healthy)    5432/tcp
fraud-db                                        postgres:16                                   "docker-entrypoint.s…"   fraud-db             8 minutes ago    Up 8 minutes (healthy)    5432/tcp
fraud-worker                                    super_good_ticketing_system-fraud-worker      "docker-entrypoint.s…"   fraud-worker         44 seconds ago   Up 36 seconds (healthy)   3000/tcp
holmes                                          super_good_ticketing_system-holmes            "sleep infinity"         holmes               45 seconds ago   Up 42 seconds             
notification                                    super_good_ticketing_system-notification      "docker-entrypoint.s…"   notification         45 seconds ago   Up 42 seconds (healthy)   0.0.0.0:3002->3000/tcp, [::]:3002->3000/tcp
payment-db                                      postgres:16                                   "docker-entrypoint.s…"   payment-db           8 minutes ago    Up 8 minutes (healthy)    5432/tcp
redis                                           redis:7                                       "docker-entrypoint.s…"   redis                8 minutes ago    Up 8 minutes (healthy)    6379/tcp
refund                                          super_good_ticketing_system-refund            "docker-entrypoint.s…"   refund               45 seconds ago   Up 42 seconds (healthy)   0.0.0.0:3001->3000/tcp, [::]:3001->3000/tcp
refund-db                                       postgres:16                                   "docker-entrypoint.s…"   refund-db            8 minutes ago    Up 8 minutes (healthy)    5432/tcp
super_good_ticketing_system-caddy-1             caddy:2-alpine                                "caddy run --config …"   caddy                8 minutes ago    Up 8 minutes              0.0.0.0:3000->80/tcp, [::]:3000->80/tcp
super_good_ticketing_system-event-catalog-1     super_good_ticketing_system-event-catalog     "docker-entrypoint.s…"   event-catalog        45 seconds ago   Up 42 seconds (healthy)   3005/tcp
super_good_ticketing_system-payment-2           super_good_ticketing_system-payment           "docker-entrypoint.s…"   payment              45 seconds ago   Up 42 seconds (healthy)   3001/tcp
super_good_ticketing_system-ticket-purchase-3   super_good_ticketing_system-ticket-purchase   "docker-entrypoint.s…"   ticket-purchase      45 seconds ago   Up 42 seconds (healthy)   3000/tcp
ticket-purchase-db                              postgres:16                                   "docker-entrypoint.s…"   ticket-purchase-db   8 minutes ago    Up 8 minutes (healthy)    5432/tcp
users                                           super_good_ticketing_system-users             "docker-entrypoint.s…"   users                45 seconds ago   Up 42 seconds (healthy)   0.0.0.0:3006->3006/tcp, [::]:3006->3006/tcp
users-db                                        postgres:16                                   "docker-entrypoint.s…"   users-db             8 minutes ago    Up 8 minutes (healthy)    5432/tcp
waitlist                                        super_good_ticketing_system-waitlist          "docker-entrypoint.s…"   waitlist             45 seconds ago   Up 42 seconds (healthy)
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

The whole system is functional now.

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
