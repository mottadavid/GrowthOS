import { sha256Canonical } from '../core/canonical.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const EXECUTION_ECONOMICS_RECORD_TYPE = 'execution_economics_event';
export const ECONOMICS_CERTAINTY = Object.freeze(['ACTUAL', 'ESTIMATED']);
export const ECONOMICS_KINDS = Object.freeze(['COST_USD', 'HUMAN_MINUTES']);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}
function nonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number.`);
  return value;
}
function validateCorrelation(correlation) {
  if (!correlation || typeof correlation !== 'object' || Array.isArray(correlation)) throw new Error('correlation is required.');
  const normalized = {};
  for (const key of ['runId', 'actionId', 'campaignId', 'experimentId']) {
    if (correlation[key] !== undefined && correlation[key] !== null) normalized[key] = requiredString(correlation[key], `correlation.${key}`);
  }
  if (Object.keys(normalized).length === 0) throw new Error('At least one growth correlation is required.');
  return normalized;
}

export function executionEconomicsSemanticBody(input) {
  const certainty = requiredString(input.certainty, 'certainty');
  const kind = requiredString(input.kind, 'kind');
  if (!ECONOMICS_CERTAINTY.includes(certainty)) throw new Error('Invalid economics certainty.');
  if (!ECONOMICS_KINDS.includes(kind)) throw new Error('Invalid economics kind.');
  const body = {
    schemaVersion: 1,
    economicsEventId: requiredString(input.economicsEventId, 'economicsEventId'),
    tenantId: requiredString(input.tenantId, 'tenantId'),
    kind,
    certainty,
    amount: nonNegative(input.amount, 'amount'),
    category: requiredString(input.category, 'category'),
    correlation: validateCorrelation(input.correlation),
    sourceSystem: requiredString(input.sourceSystem, 'sourceSystem'),
    evidenceRef: input.evidenceRef == null ? null : requiredString(input.evidenceRef, 'evidenceRef'),
    estimateBasisRef: input.estimateBasisRef == null ? null : requiredString(input.estimateBasisRef, 'estimateBasisRef'),
    occurredAt: new Date(input.occurredAt).toISOString()
  };
  if (!Number.isFinite(Date.parse(body.occurredAt))) throw new Error('occurredAt must be a valid date/time.');
  if (certainty === 'ACTUAL' && !body.evidenceRef) throw new Error('ACTUAL economics require evidenceRef.');
  if (certainty === 'ESTIMATED' && !body.estimateBasisRef) throw new Error('ESTIMATED economics require estimateBasisRef.');
  return body;
}

export function executionEconomicsSemanticHash(input) {
  return sha256Canonical(executionEconomicsSemanticBody(input));
}

function validateRecord(record, tenantId) {
  const payload = record?.payload;
  if (!payload || payload.schemaVersion !== 1) throw new Error('Invalid execution economics payload.');
  const body = executionEconomicsSemanticBody(payload.event);
  const hash = sha256Canonical(body);
  if (hash !== payload.semanticHash) throw new Error('EXECUTION_ECONOMICS_SEMANTIC_HASH_MISMATCH');
  if (record.tenantId !== tenantId || body.tenantId !== tenantId || record.recordId !== body.economicsEventId) throw new Error('EXECUTION_ECONOMICS_IDENTITY_MISMATCH');
  return record;
}

export async function loadDurableExecutionEconomicsEvent({ store, tenantId, economicsEventId }) {
  requiredString(tenantId, 'tenantId'); requiredString(economicsEventId, 'economicsEventId');
  const record = await store.getRecord({ tenantId, recordType: EXECUTION_ECONOMICS_RECORD_TYPE, recordId: economicsEventId });
  return record ? validateRecord(record, tenantId) : null;
}

export async function ingestDurableExecutionEconomicsEvent({ store, event, now = new Date() }) {
  const body = executionEconomicsSemanticBody(event);
  const semanticHash = sha256Canonical(body);
  const existing = await loadDurableExecutionEconomicsEvent({ store, tenantId: body.tenantId, economicsEventId: body.economicsEventId });
  if (existing) {
    if (existing.payload.semanticHash !== semanticHash) throw new Error('EXECUTION_ECONOMICS_EVENT_CONFLICT');
    return { record: existing, idempotent: true };
  }
  const primaryCorrelation = body.correlation.actionId || body.correlation.campaignId || body.correlation.experimentId || body.correlation.runId;
  const saved = await mutateAuthoritativeRuntimeState({
    store,
    tenantId: body.tenantId,
    recordType: EXECUTION_ECONOMICS_RECORD_TYPE,
    recordId: body.economicsEventId,
    indexKey: primaryCorrelation,
    payload: { schemaVersion: 1, event: body, semanticHash },
    expectedRevision: 0,
    now,
    event: {
      eventId: `execution-economics:${body.economicsEventId}`,
      eventType: 'growth.execution_economics.recorded',
      correlationId: primaryCorrelation,
      payload: { economicsEventId: body.economicsEventId, kind: body.kind, certainty: body.certainty, amount: body.amount, category: body.category, semanticHash }
    }
  });
  return { record: validateRecord(saved.record, body.tenantId), idempotent: false };
}

export async function listDurableExecutionEconomicsEvents({ store, tenantId, correlationId, limit = 1000 }) {
  requiredString(tenantId, 'tenantId'); requiredString(correlationId, 'correlationId');
  const records = await store.listRecords({ tenantId, recordType: EXECUTION_ECONOMICS_RECORD_TYPE, indexKey: correlationId, limit });
  return records.map(record => validateRecord(record, tenantId));
}

export function summarizeExecutionEconomics(records) {
  const summary = { actualCostUsd: 0, estimatedCostUsd: 0, actualHumanMinutes: 0, estimatedHumanMinutes: 0, eventCount: records.length };
  for (const record of records) {
    const event = record.payload?.event ?? record.event;
    executionEconomicsSemanticBody(event);
    if (event.kind === 'COST_USD' && event.certainty === 'ACTUAL') summary.actualCostUsd += event.amount;
    if (event.kind === 'COST_USD' && event.certainty === 'ESTIMATED') summary.estimatedCostUsd += event.amount;
    if (event.kind === 'HUMAN_MINUTES' && event.certainty === 'ACTUAL') summary.actualHumanMinutes += event.amount;
    if (event.kind === 'HUMAN_MINUTES' && event.certainty === 'ESTIMATED') summary.estimatedHumanMinutes += event.amount;
  }
  return summary;
}
