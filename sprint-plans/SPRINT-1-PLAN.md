# Sprint 1 Plan — [Team Name]

**Sprint:** 1 — Foundation  
**Dates:** 04.07 → 04.14  
**Written:** 04.07 in class

---

## Goal

Create our `event-catalog`, `ticket-purchase`, `payment` and `notifications` services online after running `docker compose up`, with working `/health` endpoints. `ticket-purchase` will make a synchronous call to `payment`.

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

### [Name]

- [ ] Set up `[service]/` with Express + Postgres connection
- [ ] Implement `GET /health` with DB check
- [ ] Write `db/schema.sql` and seed script
- [ ] Add `healthcheck` directive to `compose.yml`

### [Name]

- [ ] Set up `[service]/` with Express + Redis connection
- [ ] Implement `GET /health` with Redis check
- [ ] Implement `GET /[resource]` — stub returning placeholder data
- [ ] Test synchronous call to [other service]

### [Name]

- [ ] Wire `depends_on: condition: service_healthy` in `compose.yml`
- [ ] Write `k6/sprint-1.js` baseline load test
- [ ] Write `README.md` startup instructions and endpoint list

---

## Risks

[What could go wrong? What are you uncertain about? What will you do if a task takes longer than expected?]

---

## Definition of Done

A TA can clone this repo, check out `sprint-1`, run `docker compose up`, and:

- `docker compose ps` shows every service as `(healthy)`
- `GET /health` on each service returns `200` with DB and Redis status
- The synchronous service-to-service call works end-to-end
- k6 baseline results are included in `SPRINT-1.md`
