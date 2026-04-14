-- create "events" table

-- purchase_id should be unique for each 

CREATE TABLE refunds (
    purchase_id INT NOT NULL PRIMARY KEY,
    refund_status VARCHAR(20) NOT NULL DEFAULT 'pending', 
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

