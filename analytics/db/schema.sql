-- Purchase events
CREATE TABLE IF NOT EXISTS purchase_events (
	idem_key       TEXT PRIMARY KEY,
	source_service TEXT NOT NULL,
	event_id       TEXT NOT NULL,
	order_id       BIGINT NOT NULL,
	payment_id     TEXT,
	user_id        TEXT,
	seats          INTEGER NOT NULL,
	price_usd      NUMERIC(12, 2) NOT NULL,
	emitted_at     TIMESTAMPTZ NOT NULL,
	payload        JSONB NOT NULL,
	processed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_purchase_events_event_id ON purchase_events (event_id);

-- Browse events
CREATE TABLE IF NOT EXISTS browse_events (
	idem_key       TEXT PRIMARY KEY,
	source_service TEXT NOT NULL,
	event_id       TEXT NOT NULL,
	user_id        TEXT,
	seats          INTEGER,
	price_usd      NUMERIC(12, 2),
	emitted_at     TIMESTAMPTZ NOT NULL,
	payload        JSONB NOT NULL,
	processed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_browse_events_event_id ON browse_events (event_id);

-- Refund events
CREATE TABLE IF NOT EXISTS refund_events (
	idem_key       TEXT PRIMARY KEY,
	source_service TEXT NOT NULL,
	event_id       TEXT NOT NULL,
	payment_id     TEXT,
	user_id        TEXT,
	seats          INTEGER NOT NULL,
	price_usd      NUMERIC(12, 2) NOT NULL,
	emitted_at     TIMESTAMPTZ NOT NULL,
	payload        JSONB NOT NULL,
	processed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refund_events_event_id ON refund_events (event_id);

-- For most viewed events
CREATE TABLE IF NOT EXISTS event_view_aggregates (
	event_id       TEXT PRIMARY KEY,
	view_count     BIGINT NOT NULL DEFAULT 0,
	last_viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- For peak browse times
CREATE TABLE IF NOT EXISTS event_browse_hourly (
	event_id    TEXT NOT NULL,
	hour_bucket TIMESTAMPTZ NOT NULL,
	view_count  BIGINT NOT NULL DEFAULT 0,
	PRIMARY KEY (event_id, hour_bucket)
);

-- For tickets sold per event
-- ORDER BY tickets_refunded DESC gives most-refunded event ranking
CREATE TABLE IF NOT EXISTS event_sales_aggregates (
	event_id         TEXT PRIMARY KEY,
	tickets_sold     BIGINT NOT NULL DEFAULT 0,
	gross_revenue    NUMERIC(14, 2) NOT NULL DEFAULT 0,
	purchase_events  BIGINT NOT NULL DEFAULT 0,
	tickets_refunded BIGINT NOT NULL DEFAULT 0,
	refunded_revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
	refund_events    BIGINT NOT NULL DEFAULT 0,
	updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
