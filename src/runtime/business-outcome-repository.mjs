import { sha256Canonical } from '../core/canonical.mjs';
import { createOutcomeEvent, validateGrowthEvent } from '../core/growth-events.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const BUSINESS_OUTCOME_RECORD_TYPE = 'business_outcome';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function iso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date/time.`);
  return date.toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function canonicalIdentity({ tenantId, sourceSystem, canonicalOutcomeId }) {
  return {
    tenantId: requiredString(tenantId, 'tenantId'),
    sourceSystem: requiredString(sourceSystem, 'sourceSystem'),
    canonicalOutcomeId: requiredString(canonicalOutcomeId, 'canonicalOutcomeId')
  };
}

export function durableBusinessOutcomeId(input) {
  return `outcome-${sha256Canonical(canonicalIdentity(input))}`;
}

function semanticBody(input) {
  const identity = canonicalIdentity(input);
  return {
    ...identity,
    correlationId: requiredString(input.correlationId, 'correlationId'),
    outcomeType: requiredString(input.outcomeType, 'outcomeType'),
    outcomeValue: input.outcomeValue ?? null,
    attributionConfidence: requiredString(input.attributionConfidence, 'attributionConfidence'),
    attributionEvidence: Array.isArray(input.attributionEvidence) ? clone(input.attributionEvidence) : [],
    directCorrelationId: input.directCorrelationId ?? null,
    occurredAt: iso(input.occurredAt ?? new Date(), 'occurredAt')
  };
}

function validateOutcomeRecord(record, tenantId) {
  const payload = record?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('business outcome payload must be an object.');
  if (payload.schemaVersion !== 1) throw new Error('Unsupported business outcome schemaVersion.');
  requiredString(payload.recordId, 'payload.recordId');
  if (!/^[0-9a-f]{64}$/.test(payload.semanticHash || '')) throw new Error('payload.semanticHash must be SHA-256 hex.');
  validateGrowthEvent(payload.event);
  if (payload.event.eventType !== 'growth.business_outcome.observed') throw new Error('DURABLE_BUSINESS_OUTCOME_EVENT_TYPE_INVALID');
  const expectedId = durableBusinessOutcomeId({
    tenantId: payload.event.tenantId,
    sourceSystem: payload.event.sourceSystem,
    canonicalOutcomeId: payload.event.payload?.canonicalOutcomeId
  });
  if (
    record.tenantId !== tenantId ||
    payload.event.tenantId !== tenantId ||
    record.recordId !== payload.recordId ||
    record.recordId !== expectedId ||
    record.indexKey !== payload.event.correlationId
  ) {
    throw new Error('DURABLE_BUSINESS_OUTCOME_IDENTITY_MISMATCH');
  }
  const semantic = {
    tenantId: payload.event.tenantId,
    sourceSystem: payload.event.sourceSystem,
    canonicalOutcomeId: payload.event.payload.canonicalOutcomeId,
    correlationId: payload.event.correlationId,
    outcomeType: payload.event.payload.outcomeType,
    outcomeValue: payload.event.payload.outcomeValue ?? null,
    attributionConfidence: payload.event.attributionConfidence,
    attributionEvidence: clone(payload.event.payload.attribution?.evidence ?? []),
    directCorrelationId: payload.event.payload.attribution?.directCorrelationId ?? null,
    occurredAt: payload.event.occurredAt
  };
  if (sha256Canonical(semantic) !== payload.semanticHash) throw new Error('DURABLE_BUSINESS_OUTCOME_SEMANTIC_HASH_MISMATCH');
  return record;
}

export async function loadDurableBusinessOutcome({ store, tenantId, sourceSystem, canonicalOutcomeId }) {
  const recordId = durableBusinessOutcomeId({ tenantId, sourceSystem, canonicalOutcomeId });
  const record = await store.getRecord({ tenantId, recordType: BUSINESS_OUTCOME_RECORD_TYPE, recordId });
  if (!record) return null;
  return validateOutcomeRecord(record, tenantId);
}

export async function listDurableBusinessOutcomes({ store, tenantId, correlationId, limit = 1000 }) {
  requiredString(tenantId, 'tenantId');
  requiredString(correlationId, 'correlationId');
  const records = await store.listRecords({
    tenantId,
    recordType: BUSINESS_OUTCOME_RECORD_TYPE,
    indexKey: correlationId,
    limit
  });
  return records.map(record => validateOutcomeRecord(record, tenantId));
}

export async function ingestDurableBusinessOutcome({ store, recordedAt = new Date(), ...input }) {
  const semantic = semanticBody(input);
  const semanticHash = sha256Canonical(semantic);
  const recordId = durableBusinessOutcomeId(semantic);
  const existing = await loadDurableBusinessOutcome({
    store,
    tenantId: semantic.tenantId,
    sourceSystem: semantic.sourceSystem,
    canonicalOutcomeId: semantic.canonicalOutcomeId
  });
  if (existing) {
    if (existing.payload.semanticHash !== semanticHash) throw new Error('DURABLE_BUSINESS_OUTCOME_CONFLICT');
    return { record: existing, event: clone(existing.payload.event), idempotent: true };
  }

  const event = createOutcomeEvent({
    tenantId: semantic.tenantId,
    correlationId: semantic.correlationId,
    sourceSystem: semantic.sourceSystem,
    canonicalOutcomeId: semantic.canonicalOutcomeId,
    outcomeType: semantic.outcomeType,
    outcomeValue: clone(semantic.outcomeValue),
    attributionConfidence: semantic.attributionConfidence,
    attributionEvidence: clone(semantic.attributionEvidence),
    directCorrelationId: semantic.directCorrelationId,
    occurredAt: semantic.occurredAt
  });
  event.eventId = `growth-${recordId}`;
  event.recordedAt = iso(recordedAt, 'recordedAt');
  validateGrowthEvent(event);

  const payload = {
    schemaVersion: 1,
    recordId,
    semanticHash,
    event: clone(event)
  };

  const result = await mutateAuthoritativeRuntimeState({
    store,
    tenantId: semantic.tenantId,
    recordType: BUSINESS_OUTCOME_RECORD_TYPE,
    recordId,
    indexKey: semantic.correlationId,
    payload,
    expectedRevision: 0,
    now: recordedAt,
    event: {
      eventId: `business-outcome:${recordId}`,
      eventType: 'growth.business_outcome.persisted',
      payload: {
        recordId,
        growthEventId: event.eventId,
        canonicalOutcomeId: semantic.canonicalOutcomeId,
        sourceSystem: semantic.sourceSystem,
        outcomeType: semantic.outcomeType,
        attributionConfidence: semantic.attributionConfidence,
        semanticHash,
        outcomeValueHash: sha256Canonical(semantic.outcomeValue)
      },
      correlationId: semantic.correlationId
    }
  });

  return {
    record: validateOutcomeRecord(result.record, semantic.tenantId),
    event: clone(event),
    idempotent: false
  };
}
