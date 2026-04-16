-- create "eventCatalog" table
CREATE TABLE eventCatalog (
    id varchar(100) PRIMARY KEY,
    name varchar(100) NOT NULL,
    venue varchar(100) NOT NULL,
    eventDate DATE NOT NULL,
    totalSeats int CHECK (totalSeats > 0),
    availableSeats int NOT NULL,
    priceUsd DECIMAL(10, 2) CHECK (priceUsd >= 0),
);
