import { sha256Canonical } from '../core/canonical.mjs';
import { runtimePayloadHash, validateRuntimeRecord, validateRuntimeEvent } from './store.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function validDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date/time.`);
  return date.toISOString();
}

function runtimeError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function rowToRecord(row) {
  if (!row) return null;
  const record = {
    tenantId: row.tenant_id,
    recordType: row.record_type,
    recordId: row.record_id,
    revision: Number(row.revision),
    payload: row.payload,
    payloadHash: row.payload_hash,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
  validateRuntimeRecord(record);
  return record;
}

function rowToEvent(row) {
  if (!row) return null;
  const event = {
    eventId: row.event_id,
    tenantId: row.tenant_id,
    eventType: row.event_type,
    occurredAt: new Date(row.occurred_at).toISOString(),
    recordedAt: new Date(row.recorded_at).toISOString(),
    correlationId: row.correlation_id ?? null,
    causationId: row.causation_id ?? null,
    payload: row.payload,
    payloadHash: row.payload_hash
  };
  validateRuntimeEvent(event);
  return event;
}

export class PostgresRuntimeStore {
  constructor({ query }) {
    if (typeof query !== 'function') throw new Error('PostgresRuntimeStore requires query(text, values).');
    this.query = query;
  }

  async getRecord({ tenantId, recordType, recordId }) {
    requiredString(tenantId, 'tenantId');
    requiredString(recordType, 'recordType');
    requiredString(recordId, 'recordId');
    const result = await this.query(
      `SELECT tenant_id, record_type, record_id, revision, payload, payload_hash, created_at, updated_at
         FROM growthos_records
        WHERE tenant_id = $1 AND record_type = $2 AND record_id = $3`,
      [tenantId, recordType, recordId]
    );
    return rowToRecord(result.rows?.[0] ?? null);
  }

  async putRecord({ tenantId, recordType, recordId, payload, expectedRevision, now = new Date() }) {
    requiredString(tenantId, 'tenantId');
    requiredString(recordType, 'recordType');
    requiredString(recordId, 'recordId');
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('expectedRevision must be a non-negative integer.');
    const timestamp = validDate(now, 'now');
    const payloadHash = runtimePayloadHash(payload);

    if (expectedRevision === 0) {
      const result = await this.query(
        `INSERT INTO growthos_records
           (tenant_id, record_type, record_id, revision, payload, payload_hash, created_at, updated_at)
         VALUES ($1, $2, $3, 1, $4::jsonb, $5, $6::timestamptz, $6::timestamptz)
         ON CONFLICT (tenant_id, record_type, record_id) DO NOTHING
         RETURNING tenant_id, record_type, record_id, revision, payload, payload_hash, created_at, updated_at`,
        [tenantId, recordType, recordId, JSON.stringify(payload), payloadHash, timestamp]
      );
      if (!result.rows?.[0]) throw runtimeError('RUNTIME_RECORD_REVISION_CONFLICT');
      return rowToRecord(result.rows[0]);
    }

    const result = await this.query(
      `UPDATE growthos_records
          SET revision = revision + 1,
              payload = $4::jsonb,
              payload_hash = $5,
              updated_at = $6::timestamptz
        WHERE tenant_id = $1
          AND record_type = $2
          AND record_id = $3
          AND revision = $7
      RETURNING tenant_id, record_type, record_id, revision, payload, payload_hash, created_at, updated_at`,
      [tenantId, recordType, recordId, JSON.stringify(payload), payloadHash, timestamp, expectedRevision]
    );
    if (!result.rows?.[0]) throw runtimeError('RUNTIME_RECORD_REVISION_CONFLICT');
    return rowToRecord(result.rows[0]);
  }

  async appendEvent({
    eventId,
    tenantId,
    eventType,
    payload,
    occurredAt = new Date(),
    recordedAt = new Date(),
    correlationId = null,
    causationId = null
  }) {
    requiredString(eventId, 'eventId');
    requiredString(tenantId, 'tenantId');
    requiredString(eventType, 'eventType');
    const occurred = validDate(occurredAt, 'occurredAt');
    const recorded = validDate(recordedAt, 'recordedAt');
    const payloadHash = runtimePayloadHash(payload);

    const insert = await this.query(
      `INSERT INTO growthos_events
         (event_id, tenant_id, event_type, occurred_at, recorded_at, correlation_id, causation_id, payload, payload_hash)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8::jsonb, $9)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id, tenant_id, event_type, occurred_at, recorded_at, correlation_id, causation_id, payload, payload_hash`,
      [eventId, tenantId, eventType, occurred, recorded, correlationId, causationId, JSON.stringify(payload), payloadHash]
    );

    if (insert.rows?.[0]) return { event: rowToEvent(insert.rows[0]), idempotent: false };

    const existingResult = await this.query(
      `SELECT event_id, tenant_id, event_type, occurred_at, recorded_at, correlation_id, causation_id, payload, payload_hash
         FROM growthos_events
        WHERE event_id = $1`,
      [eventId]
    );
    const existing = rowToEvent(existingResult.rows?.[0] ?? null);
    if (!existing) throw runtimeError('RUNTIME_EVENT_ID_CONFLICT');

    const candidate = {
      eventId,
      tenantId,
      eventType,
      occurredAt: occurred,
      recordedAt: recorded,
      correlationId,
      causationId,
      payload,
      payloadHash
    };
    validateRuntimeEvent(candidate);
    if (sha256Canonical(existing) !== sha256Canonical(candidate)) throw runtimeError('RUNTIME_EVENT_ID_CONFLICT');
    return { event: existing, idempotent: true };
  }

  async listEvents({ tenantId, correlationId = null, limit = 1000 }) {
    requiredString(tenantId, 'tenantId');
    if (correlationId !== null) requiredString(correlationId, 'correlationId');
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('limit must be an integer between 1 and 10000.');

    const result = await this.query(
      `SELECT event_id, tenant_id, event_type, occurred_at, recorded_at, correlation_id, causation_id, payload, payload_hash
         FROM growthos_events
        WHERE tenant_id = $1
          AND ($2::text IS NULL OR correlation_id = $2)
        ORDER BY recorded_at ASC, event_id ASC
        LIMIT $3`,
      [tenantId, correlationId, limit]
    );
    return (result.rows || []).map(rowToEvent);
  }
}
