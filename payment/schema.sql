CREATE TABLE payments (
    payment_id    CHAR(36)       NOT NULL PRIMARY KEY,
    token           VARCHAR(255) NOT NULL, 
    status          VARCHAR(10) NOT NULL CHECK (status IN ('success', 'failure')),
    message         TEXT, 
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);