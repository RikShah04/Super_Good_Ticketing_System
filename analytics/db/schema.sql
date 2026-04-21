CREATE TABLE IF NOT EXISTS analytics_events (
	dedupe_key      TEXT PRIMARY KEY,
	event_type      TEXT NOT NULL,
	source_service  TEXT NOT NULL,
	event_id        TEXT NOT NULL,
	order_id        BIGINT,
	payment_id      TEXT,
	seats           INTEGER,
	price_usd       NUMERIC(12, 2),
	emitted_at      TIMESTAMPTZ NOT NULL,
	payload         JSONB NOT NULL,
	processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_sales_aggregates (
	event_id         TEXT PRIMARY KEY,
	tickets_sold     BIGINT NOT NULL DEFAULT 0,
	gross_revenue    NUMERIC(14, 2) NOT NULL DEFAULT 0,
	purchase_events  BIGINT NOT NULL DEFAULT 0,
	updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
