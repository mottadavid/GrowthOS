CREATE TABLE IF NOT EXISTS growthos_records (
    tenant_id TEXT NOT NULL,
    record_type TEXT NOT NULL,
    record_id TEXT NOT NULL,
    revision BIGINT NOT NULL CHECK (revision >= 1),
    payload JSONB NOT NULL,
    payload_hash CHAR(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (tenant_id, record_type, record_id),
    CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS growthos_records_tenant_type_updated_idx
    ON growthos_records (tenant_id, record_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS growthos_events (
    event_id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL,
    correlation_id TEXT NULL,
    causation_id TEXT NULL,
    payload JSONB NOT NULL,
    payload_hash CHAR(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS growthos_events_tenant_recorded_idx
    ON growthos_events (tenant_id, recorded_at ASC, event_id ASC);

CREATE INDEX IF NOT EXISTS growthos_events_tenant_correlation_recorded_idx
    ON growthos_events (tenant_id, correlation_id, recorded_at ASC, event_id ASC)
    WHERE correlation_id IS NOT NULL;
