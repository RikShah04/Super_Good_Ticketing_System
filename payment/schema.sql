DROP TABLE IF EXISTS payments;

CREATE TABLE payments (
    payment_id    CHAR(36)       NOT NULL PRIMARY KEY,
    token           VARCHAR(255) NOT NULL, 
    price           DECIMAL(10, 2) NOT NULL, 
    amount_refunded           DECIMAL(10, 2) NOT NULL, 
    status          VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failure', 'refunded', 'partial_refund')), 
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);