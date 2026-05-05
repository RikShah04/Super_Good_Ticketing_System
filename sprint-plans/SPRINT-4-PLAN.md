# Sprint 4 Plan — Super Good Ticketing System

**Sprint:** 4 — Replication, Scaling, and Polish  
**Dates:** 04.28 → 05.07  
**Written:** 04.28 in class

---

## Goal

We have already replicated `ticket-purchase`. We will also replicate `payment` and `event-catalog`.

We just have file cleanup left, no other polish work.

---

## Ownership

| Team Member | Files / Directories Owned This Sprint |
| ----------- | ------------------------------------- |
| James       | `Caddyfile` |
| Ethan       | `k6/sprint-4-scale.js` |
| Rikhav      | `k6/sprint-4-replica.js` |

---

## Tasks

### James

- [ ] Add Caddy scaling for `payment` and `event-catalog`

### Ethan

- [ ] Implement k6 scaling comparison testing

### Rikhav

- [ ] Implement k6 replica testing

### Everyone

- [ ] Update README.md documentation with service endpoints/functionality
- [ ] File cleanup

---

## Risks

We do not anticipate any risks this sprint. Compared to previous sprints, we much fewer tasks to accomplish, and because we have been careful while building our system, we also do not anticipate a lot of polish work.

---

## Definition of Done

`docker compose up --scale [service]=3` starts successfully. `docker compose ps` shows all replicas as `(healthy)`. k6 scaling comparison shows measurable improvement. Replica failure test shows no dropped requests.
