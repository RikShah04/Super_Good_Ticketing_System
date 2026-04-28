# Sprint 3 Plan — Super Good Ticketing System

**Sprint:** 3 — Reliability and Poison Pills  
**Dates:** 04.21 → 04.28  
**Written:** 04.21 in class

---

## Goal

For this sprint, we will be adding DLQs and poison pill handling to the workers for fraud, waitlist, refund. The system should be able to handle malformed JSON packages, invalid payment information, and other common errors without crashing.

---

## Ownership

| Team Member | Files / Directories Owned This Sprint |
| ----------- | ------------------------------------- |
| James      | `fraud-detection/` |
| Jonathan      | `analytics/` |
| Rikhav      | `waitlist/` |
| Jasper      | `event-catalog/` |
| Ian        | `event-catalog/`, `k6` |
| Ethan      | `ticket-purchase/` |
| Henry      | `payment/`    |
| Erika      | `refund/`     |
| James      | `fraud-detection/` |
| Jonathan      | `analytics/` |
| Rikhav      | `waitlist/` |
| Jasper      | `event-catalog/` |
| Ian        | `event-catalog/`, `k6` |
| Ethan      | `ticket-purchase/` |
| Henry      | `payment/`    |
| Erika      | `refund/`     |

---

## Tasks

### James

- [ ] fraud dlq, health
- [ ] fraud calls refund on detecting suspicious activity
- [ ] caddy load balancing

### Jonathan

- [ ] analytics dlq, health
- [ ] add userId analytics
- [ ] add browse events receiving
- [ ] expose aggregate stats

### Rikhav

- [ ] waitlist dlq, health
- [ ] waitlist process:
      - ticket-purchase /purchase pushes job when failing due to insufficient seating
      - event-catalog /unreserve_seat pushes eventId, worker uses it to pop/promote job (NOT refund, seats can be unreserved without         refund via ticket-purchase)
      - separate waitlist queues for each event (?)
      - sync-calls ticket-purchase /purchase with job data, awaiting response --> on fail, DLQ

### Jasper

- [ ] event-catalog /events pushes to analytics queue for analytics to consume
- [ ] event-catalog, ticket-purchase accept userId in request

### Ian

- [ ] Add event-catalog /unreserve_seats endpoint
- [ ] k6 poison pill

### Ethan

- [ ] Add ticket-purchase /verify endpoint
- [ ] ticket-purchase /purchase sends { type: 'purchase' } to notifications
- [ ] event-catalog, ticket-purchase accept userId in request

### Henry

- [ ] Add payment /refund endpoints

### Erika

- [ ] Refund Process:
      - idempotent
      - requires purchaseId, seats
      - calls ticket-purchase /verify to verify purchaseId, validate seats
      - ticket-purchase /verify returns eventId, paymentId
      - calls payment with paymentId to refund purchase
      - calls event-catalog /unreserve_seats with eventId to unreserve seat
      - push for analytics, notifications, waitlist
        - sends { type: 'refund' } to notifications
      - stores refund details in db (id, purchaseId, eventId, paymentId, seats, price, etc.)
---

## Risks

Many tasks depend on others being completed, so scheduling our tasks around these dependencies may slow the project down. However, good time management and communication will alleviate this issue.

Additionally, handling poison pills correctly will require vigoruos testing and we will need to ensure that we are all clear on what behavior is expected out of each service and worker.

---

## Definition of Done

After injecting poison pills, the worker's `/health` shows non-zero `dlq_depth` while status remains `healthy`. Good messages keep flowing. k6 results show throughput does not collapse.
