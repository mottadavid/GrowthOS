ALTER TABLE growthos_records
    ADD COLUMN IF NOT EXISTS index_key TEXT NULL;

CREATE INDEX IF NOT EXISTS growthos_records_tenant_type_index_key_idx
    ON growthos_records (tenant_id, record_type, index_key, updated_at DESC, record_id)
    WHERE index_key IS NOT NULL;

COMMENT ON COLUMN growthos_records.index_key IS
    'Optional immutable secondary recovery key scoped by tenant_id + record_type. Not a global identifier.';
