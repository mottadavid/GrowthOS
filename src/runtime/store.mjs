import { sha256Canonical } from '../core/canonical.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function validDate(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date/time.`);
  return date.toISOString();
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function runtimeError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function runtimePayloadHash(payload) {
  if (payload === undefined) throw new Error('payload is required.');
  return sha256Canonical(payload);
}

export function validateRuntimeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('record must be an object.');
  requiredString(record.tenantId, 'record.tenantId');
  requiredString(record.recordType, 'record.recordType');
  requiredString(record.recordId, 'record.recordId');
  if (!Number.isInteger(record.revision) || record.revision < 1) throw new Error('record.revision must be a positive integer.');
  if (!/^[0-9a-f]{64}$/.test(record.payloadHash || '')) throw new Error('record.payloadHash must be SHA-256 hex.');
  validDate(record.createdAt, 'record.createdAt');
  validDate(record.updatedAt, 'record.updatedAt');
  if (runtimePayloadHash(record.payload) !== record.payloadHash) throw runtimeError('RUNTIME_RECORD_HASH_MISMATCH');
  return record;
}

export function validateRuntimeEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('event must be an object.');
  requiredString(event.eventId, 'event.eventId');
  requiredString(event.tenantId, 'event.tenantId');
  requiredString(event.eventType, 'event.eventType');
  validDate(event.occurredAt, 'event.occurredAt');
  validDate(event.recordedAt, 'event.recordedAt');
  if (event.correlationId !== null && event.correlationId !== undefined) requiredString(event.correlationId, 'event.correlationId');
  if (event.causationId !== null && event.causationId !== undefined) requiredString(event.causationId, 'event.causationId');
  if (!/^[0-9a-f]{64}$/.test(event.payloadHash || '')) throw new Error('event.payloadHash must be SHA-256 hex.');
  if (runtimePayloadHash(event.payload) !== event.payloadHash) throw runtimeError('RUNTIME_EVENT_HASH_MISMATCH');
  return event;
}

export class InMemoryRuntimeStore {
  constructor() {
    this.records = new Map();
    this.events = new Map();
  }

  recordKey({ tenantId, recordType, recordId }) {
    return `${tenantId}\u0000${recordType}\u0000${recordId}`;
  }

  async getRecord({ tenantId, recordType, recordId }) {
    requiredString(tenantId, 'tenantId');
    requiredString(recordType, 'recordType');
    requiredString(recordId, 'recordId');
    const stored = this.records.get(this.recordKey({ tenantId, recordType, recordId }));
    if (!stored) return null;
    validateRuntimeRecord(stored);
    return clone(stored);
  }

  async putRecord({ tenantId, recordType, recordId, payload, expectedRevision, now = new Date() }) {
    requiredString(tenantId, 'tenantId');
    requiredString(recordType, 'recordType');
    requiredString(recordId, 'recordId');
    nonNegativeInteger(expectedRevision, 'expectedRevision');
    const key = this.recordKey({ tenantId, recordType, recordId });
    const existing = this.records.get(key) || null;
    const currentRevision = existing?.revision ?? 0;
    if (currentRevision !== expectedRevision) throw runtimeError('RUNTIME_RECORD_REVISION_CONFLICT');

    const timestamp = validDate(now, 'now');
    const next = {
      tenantId,
      recordType,
      recordId,
      revision: expectedRevision + 1,
      payload: clone(payload),
      payloadHash: runtimePayloadHash(payload),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };
    validateRuntimeRecord(next);
    this.records.set(key, clone(next));
    return clone(next);
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
    const candidate = {
      eventId,
      tenantId: requiredString(tenantId, 'tenantId'),
      eventType: requiredString(eventType, 'eventType'),
      occurredAt: validDate(occurredAt, 'occurredAt'),
      recordedAt: validDate(recordedAt, 'recordedAt'),
      correlationId,
      causationId,
      payload: clone(payload),
      payloadHash: runtimePayloadHash(payload)
    };
    validateRuntimeEvent(candidate);

    const existing = this.events.get(eventId);
    if (existing) {
      validateRuntimeEvent(existing);
      if (sha256Canonical(existing) !== sha256Canonical(candidate)) {
        throw runtimeError('RUNTIME_EVENT_ID_CONFLICT');
      }
      return { event: clone(existing), idempotent: true };
    }

    this.events.set(eventId, clone(candidate));
    return { event: clone(candidate), idempotent: false };
  }

  async listEvents({ tenantId, correlationId = null, limit = 1000 }) {
    requiredString(tenantId, 'tenantId');
    if (correlationId !== null) requiredString(correlationId, 'correlationId');
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('limit must be an integer between 1 and 10000.');

    return [...this.events.values()]
      .map((event) => {
        validateRuntimeEvent(event);
        return event;
      })
      .filter((event) => event.tenantId === tenantId)
      .filter((event) => correlationId === null || event.correlationId === correlationId)
      .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt))
      .slice(0, limit)
      .map(clone);
  }
}
