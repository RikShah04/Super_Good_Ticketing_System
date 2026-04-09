# Sprint 1 Plan — Super Good Ticketing System

**Sprint:** 1 — Foundation  
**Dates:** 04.07 → 04.14  
**Written:** 04.07 in class

---

## Goal

Create all our services and workers, and verify that they start correctly with `docker compose up`. `ticket-purchase` will make a synchronous call to `payment`, and all services will have a `/health` endpoint. Establish a baseline with `k6` testing to service endpoints.

---

## Ownership

| Team Member | Files / Directories Owned This Sprint |
| ----------- | ----------------------------------------------- |
| Ian Mei, Ethan Pham | `ticket-purchase/`, `ticket-purchase/db/schema.sql`, `waitlist/` |
| Jasper McCormack | `event-catalog/`,`event-catalog/db/schema.sql` |
| Henry Branham | `payment/`, `k6/` |
| Rikhav Shah | `notification/` |
| Erika Lam | `refund/`, `refund/db/schema.sql` |
| James Rust | `fraud-detection/`, `fraud-detection/db/schema.sql` |
| Jonathan Zhang | `analytics/`, `analytics/db/schema.sql` |

Each person must have meaningful commits in the paths they claim. Ownership is verified by:

```bash
git log --author="Name" --oneline -- path/to/directory/
```

---

## Tasks

### [Ian Mei]

- [ ] Write `ticket-purchase/db/schema.sql`
- [ ] Add `healthcheck` directive to `compose.yml`

### [Ethan Pham]

- [ ] Set up `ticket-purchase/` with Express + Redis connection
- [ ] Implement `GET /health` with Redis check
- [ ] Implement `POST /purchase` — calls `payment` service to simulate processing

### [Jasper McCormack]

- [ ] Wire `depends_on: condition: service_healthy` in `compose.yml`
- [ ] Write `k6/sprint-1.js` baseline load test
- [ ] Write `README.md` startup instructions and endpoint list

### [Henry Braham]

- [ ] Wire `depends_on: condition: service_healthy` in `compose.yml`
- [ ] Write `k6/sprint-1.js` baseline load test
- [ ] Write `README.md` startup instructions and endpoint list

### [Rikhav Shah]

- [ ] Set up `[service]/` with Express + Postgres connection
- [ ] Implement `GET /health` with DB check
- [ ] Write `db/schema.sql` and seed script
- [ ] Add `healthcheck` directive to `compose.yml`

### [Erika Lam]

- [ ] Set up `refund/` with Express + Redis connection
- [ ] Implement `GET /health` with Redis check
- [ ] Implement `GET /seat-released` — stub returning placeholder data
- [ ] Add `healthcheck` directive to `compose.yml`
- [ ] Test synchronous call to Ticket Purchase Service
- [ ] Write `refund/db/schema.sql`

### [James Rust]

- [ ] Wire `depends_on: condition: service_healthy` in `compose.yml`
- [ ] Write `k6/sprint-1.js` baseline load test
- [ ] Write `README.md` startup instructions and endpoint list

### [Jonathan Zhang]

- [ ] Set up analytics in compose.yml.
- [ ] `GET /health` returns `200`.

---

## Risks

During this sprint, we expect to encounter issues when connceting the logic to the html. Similarly, with so many moving parts being developed individually, we expect to run into problems when connecting them all together. As a result, we believe that crashing will occur. 

If a task takes longer than expected, team members will communicate to the rest of the team. From there, we will redesign the task for the next sprint, aiming to set more realistic expectations for the next sprint and redefining the task into smaller, more manageable tasks. 

---

## Definition of Done

A TA can clone this repo, check out `sprint-1`, run `docker compose up`, and:

- `docker compose ps` shows every service as `(healthy)`
- `GET /health` on each service returns `200` with DB and Redis status
- The synchronous service-to-service call works end-to-end
- k6 baseline results are included in `SPRINT-1.md`
