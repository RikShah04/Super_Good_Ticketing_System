CREATE TABLE events (
    event_id    CHAR(36)       NOT NULL PRIMARY KEY,
    name        VARCHAR(255)   NOT NULL,
    venue       VARCHAR(255)   NOT NULL,
    eventDate   TIMESTAMP      NOT NULL,
    availableSeats INT         NOT NULL,
    priceUsd    DECIMAL(10, 2) NOT NULL
);

