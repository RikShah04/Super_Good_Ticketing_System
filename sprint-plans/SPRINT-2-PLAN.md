# Sprint 2 Plan — Super Good Ticketing System

**Sprint:** 2 — Async Pipelines and Caching  
**Dates:** 04.14 → 04.21  
**Written:** 04.14 in class

---

## Goal

We hope to have the asynchronous ticket purchasing pipeline completed by the end of the sprint. This will involve changes to all services and workers but `refunds` and `waitlist`. Redis, in particular, will see a lot more usage as each service and worker uses it to cache data and implement idempotency. The databases may also see changes to the data they store.

---

## Ownership

| Team Member | Files / Directories Owned This Sprint |
| ----------- | ------------------------------------- |
| Ian Mei, Ethan Pham | `ticket-purchase/` |
| Ian Mei, Jasper McCormack | `event-catalog` |
| Henry Branham | `payment/` |
| Rikhav Shah | `notification/` |
| Erika Lam | `k6/` |
| James Rust | `fraud-detection` |
| Jonathan Zhang | `analytics/` |

---

## Tasks

### [Ian Mei]

- [ ] `event-catalog` endpoint:
    - accepts event and to-update seat data
    - logs data being requested
    - updates seat count
    - logs seat count update
    - returns success or no available seat

### [Ethan Pham]

- [ ] idempotent `ticket-purchase` endpoint:
    - queries `event-catalog` for seat
    - messages fraud-detection before payment, aborting if fraud-detection flags purchase
    - queries and retries `payments` for purchase, querying `event-catalog` to confirm seat if successful
    - for persistent failures, queries `event-catalog` to unreserve seat and messages `waitlist` to promote job
    - pushes job for `waitlist` if no seat available
    - saves purchase attempt to db
    - logs each step

### [Jasper McCormack]

- [ ] sample data populating db
- [ ] `event-catalog` endpoint returning all events
- [ ] `event-catalog` endpoint returning event details
- [ ] redis caching for frequently requested/viewed events

### [Henry Branham]

- [ ] `payments` endpoint:
    - simulates processing (sleep time)
    - logs start of processing
    - simulates low but non-zero failure rate
    - logs success/failure
    - records purchase in db
    

### [Rikhav Shah]

- [ ] `notifications` subs to purchase events
- [ ] `notifications` logs to console to simulate email send

### [Erika Lam]

- [ ] `k6` tests async pipeline
- [ ] `k6` tests event-catalog caching

### [James Rust]

- [ ] `fraud-detection` subs to fraud-check events:
    - logs receipt of event
    - determines if event is fraudulent
    - saves to db
    - returns result

### [Jonathan Zhang]

- [ ] `analytics` subs to purchase events:
    - logs receipt of event
    - generates aggregate metrics
    - saves to db

---

## Risks

Many tasks depend on others being completed, so scheduling our tasks around these dependencies may slow the project down. However, good time management and communication will alleviate this issue.

---

## Definition of Done

A TA can trigger an action, watch the queue flow in Docker Compose logs, hit the worker's `/health` to see queue depth and last-job-at, and review k6 results showing the caching improvement.
