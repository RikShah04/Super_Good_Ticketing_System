-- create "events" table

-- purchase_id should be unique for each 

CREATE TABLE IF NOT EXISTS refunds (
  id SERIAL PRIMARY KEY,
  purchase_id INTEGER NOT NULL,
  event_id UUID NOT NULL,
  payment_id TEXT NOT NULL,
  seats INTEGER NOT NULL,
  amount NUMERIC(10,2),
  status TEXT NOT NULL,
  refunded_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);