import { sha256Canonical } from '../core/canonical.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';
import { loadDurableExecutionAttempt } from './execution-attempt-repository.mjs';
import { loadDurableWiserrReactivationCommand } from './wiserr-reactivation-command-repository.mjs';

export const EXECUTION_ECONOMICS_RECORD_TYPE = 'execution_economics';
export const EXECUTION_ECONOMICS_METRICS = Object.freeze([
  'PROVIDER_COST_MICROS_USD',
  'MODEL_COST_MICROS_USD',
  'OPERATOR_TIME_MS',
  'COMPUTE_TIME_MS'
]);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
  return value;
}

function validIso(value, label) {
  requiredString(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid date-time.`);
  return value;
}

function clone(value) { return structuredClone(value); }

export function validateExecutionEconomicsObservation(observation) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) throw new Error('observation must be an object.');
  if (observation.schemaVersion !== 1) throw new Error('Unsupported observation.schemaVersion.');
  for (const field of ['economicsId', 'tenantId', 'actionId', 'attemptId', 'commandId', 'metricType', 'sourceSystem', 'evidenceRef', 'observedAt']) {
    requiredString(observation[field], `observation.${field}`);
  }
  if (!EXECUTION_ECONOMICS_METRICS.includes(observation.metricType)) throw new Error('Invalid observation.metricType.');
  nonNegativeInteger(observation.metricValue, 'observation.metricValue');
  validIso(observation.observedAt, 'observation.observedAt');
  for (const forbidden of ['message', 'recipient', 'providerPayload', 'customer', 'contact']) {
    if (Object.hasOwn(observation, forbidden)) throw new Error(`Execution economics observation must not embed ${forbidden} data.`);
  }
  return observation;
}

export function executionEconomicsSemanticHash(observation) {
  validateExecutionEconomicsObservation(observation);
  return sha256Canonical(observation);
}

function validateRecord(record, tenantId) {
  if (!record || typeof record !== 'object') throw new Error('durable execution economics record is required.');
  const payload = record.payload;
  if (!payload || payload.schemaVersion !== 1) throw new Error('Invalid durable execution economics payload.');
  validateExecutionEconomicsObservation(payload.observation);
  if (!/^[0-9a-f]{64}$/.test(payload.semanticHash || '')) throw new Error('payload.semanticHash must be SHA-256 hex.');
  if (executionEconomicsSemanticHash(payload.observation) !== payload.semanticHash) throw new Error('DURABLE_EXECUTION_ECONOMICS_SEMANTIC_HASH_MISMATCH');
  if (
    record.tenantId !== tenantId ||
    payload.observation.tenantId !== tenantId ||
    record.recordId !== payload.observation.economicsId ||
    record.indexKey !== payload.observation.attemptId
  ) {
    throw new Error('DURABLE_EXECUTION_ECONOMICS_IDENTITY_MISMATCH');
  }
  return record;
}

export async function loadDurableExecutionEconomics({ store, tenantId, economicsId }) {
  requiredString(tenantId, 'tenantId');
  requiredString(economicsId, 'economicsId');
  const record = await store.getRecord({ tenantId, recordType: EXECUTION_ECONOMICS_RECORD_TYPE, recordId: economicsId });
  return record ? validateRecord(record, tenantId) : null;
}

export async function listDurableExecutionEconomics({ store, tenantId, attemptId, limit = 1000 }) {
  requiredString(tenantId, 'tenantId');
  requiredString(attemptId, 'attemptId');
  const records = await store.listRecords({ tenantId, recordType: EXECUTION_ECONOMICS_RECORD_TYPE, indexKey: attemptId, limit });
  return records.map(record => validateRecord(record, tenantId));
}

async function assertObservationAuthority({ store, observation }) {
  const commandRecord = await loadDurableWiserrReactivationCommand({
    store,
    tenantId: observation.tenantId,
    commandId: observation.commandId
  });
  if (!commandRecord) throw new Error('EXECUTION_ECONOMICS_COMMAND_NOT_FOUND');
  const attemptRecord = await loadDurableExecutionAttempt({
    store,
    tenantId: observation.tenantId,
    attemptId: observation.attemptId
  });
  if (!attemptRecord) throw new Error('EXECUTION_ECONOMICS_ATTEMPT_NOT_FOUND');
  const command = commandRecord.payload.command;
  const attempt = attemptRecord.payload;
  if (
    command.tenantId !== observation.tenantId ||
    command.actionId !== observation.actionId ||
    command.attemptId !== observation.attemptId ||
    attempt.tenantId !== observation.tenantId ||
    attempt.actionId !== observation.actionId ||
    attempt.attemptId !== observation.attemptId ||
    attempt.actionHash !== command.actionHash ||
    attempt.idempotencyKey !== command.idempotencyKey
  ) {
    throw new Error('EXECUTION_ECONOMICS_AUTHORITY_MISMATCH');
  }
  if (attempt.state === 'CREATED') throw new Error('EXECUTION_ECONOMICS_ATTEMPT_NOT_SUBMITTED');
  return { commandRecord, attemptRecord };
}

export async function persistDurableExecutionEconomics({ store, observation, now = new Date() }) {
  validateExecutionEconomicsObservation(observation);
  await assertObservationAuthority({ store, observation });
  const semanticHash = executionEconomicsSemanticHash(observation);
  const existing = await loadDurableExecutionEconomics({ store, tenantId: observation.tenantId, economicsId: observation.economicsId });
  if (existing) {
    if (existing.payload.semanticHash !== semanticHash) throw new Error('DURABLE_EXECUTION_ECONOMICS_CONFLICT');
    return { record: existing, idempotent: true };
  }

  const payload = { schemaVersion: 1, observation: clone(observation), semanticHash };
  try {
    const saved = await mutateAuthoritativeRuntimeState({
      store,
      tenantId: observation.tenantId,
      recordType: EXECUTION_ECONOMICS_RECORD_TYPE,
      recordId: observation.economicsId,
      indexKey: observation.attemptId,
      payload,
      expectedRevision: 0,
      now,
      event: {
        eventId: `execution-economics:${observation.economicsId}`,
        eventType: 'growth.execution_economics.observed',
        correlationId: observation.attemptId,
        payload: {
          economicsId: observation.economicsId,
          actionId: observation.actionId,
          attemptId: observation.attemptId,
          commandId: observation.commandId,
          metricType: observation.metricType,
          metricValue: observation.metricValue,
          sourceSystem: observation.sourceSystem,
          evidenceRef: observation.evidenceRef,
          semanticHash
        }
      }
    });
    return { record: validateRecord(saved.record, observation.tenantId), idempotent: false };
  } catch (error) {
    if (error?.code !== 'RUNTIME_RECORD_REVISION_CONFLICT') throw error;
    const raced = await loadDurableExecutionEconomics({ store, tenantId: observation.tenantId, economicsId: observation.economicsId });
    if (!raced || raced.payload.semanticHash !== semanticHash) throw error;
    return { record: raced, idempotent: true };
  }
}

export async function summarizeDurableExecutionEconomics({ store, tenantId, attemptId }) {
  const records = await listDurableExecutionEconomics({ store, tenantId, attemptId });
  const metrics = Object.fromEntries(EXECUTION_ECONOMICS_METRICS.map(metric => [metric, { observationCount: 0, knownTotal: null }]));
  for (const record of records) {
    const observation = record.payload.observation;
    const slot = metrics[observation.metricType];
    slot.observationCount += 1;
    slot.knownTotal = (slot.knownTotal ?? 0) + observation.metricValue;
  }
  return {
    schemaVersion: 1,
    tenantId,
    attemptId,
    observationCount: records.length,
    metrics,
    evidence: records.map(record => ({
      economicsId: record.recordId,
      semanticHash: record.payload.semanticHash,
      metricType: record.payload.observation.metricType,
      evidenceRef: record.payload.observation.evidenceRef
    })).sort((a, b) => a.economicsId.localeCompare(b.economicsId))
  };
}
