-- create "eventCatalog" table
CREATE TABLE eventCatalog (
    id varchar(100) NOT NULL,
    name varchar(100) NOT NULL,
    venue varchar(100) NOT NULL,
    eventDate DATE NOT NULL,
    availableSeats int NOT NULL,
    priceUsd DECIMAL(10. 2) NULL,
    PRIMARY KEY (id)
);
