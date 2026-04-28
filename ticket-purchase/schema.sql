CREATE TABLE ticket_purchases (
    id                  SERIAL          NOT NULL PRIMARY KEY,
    event_id            CHAR(36)        NOT NULL,
    payment_id          CHAR(36),
    purchased_seats     INT             NOT NULL CHECK (purchased_seats > 0),
    refundable_seats    INT             NOT NULL CHECK (refundable_seats >= 0 AND refundable_seats <= purchased_seats),
    charge              DECIMAL(10, 2),
    status              VARCHAR(10)     NOT NULL CHECK (status IN ('success', 'failed', 'pending', 'refunded')),
    reason              TEXT,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP
);
