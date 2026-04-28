CREATE TABLE IF NOT EXISTS analytics_events (
	idem_key        TEXT PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_analytics_events_idem_key
	ON analytics_events (idem_key);

ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_id ON analytics_events (user_id);

CREATE TABLE IF NOT EXISTS event_view_aggregates (
	event_id        TEXT PRIMARY KEY,
	view_count      BIGINT NOT NULL DEFAULT 0,
	last_viewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_sales_aggregates (
	event_id         TEXT PRIMARY KEY,
	tickets_sold     BIGINT NOT NULL DEFAULT 0,
	gross_revenue    NUMERIC(14, 2) NOT NULL DEFAULT 0,
	purchase_events  BIGINT NOT NULL DEFAULT 0,
	updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE event_sales_aggregates
	ADD COLUMN IF NOT EXISTS tickets_refunded BIGINT         NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS refunded_revenue NUMERIC(14, 2) NOT NULL DEFAULT 0,
	ADD COLUMN IF NOT EXISTS refund_events    BIGINT         NOT NULL DEFAULT 0;
