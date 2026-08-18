import {
  EXECUTION_ATTEMPT_STATES,
  createExecutionAttempt,
  markExecutionSubmitting,
  markExecutionAccepted,
  markExecutionCompleted,
  markExecutionDefinitiveFailure,
  markExecutionNotAccepted,
  markExecutionReconciliationRequired,
  reconcileExecutionAttempt
} from '../core/execution-attempts.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const EXECUTION_ATTEMPT_RECORD_TYPE = 'execution_attempt';
const MAX_DURABLE_ATTEMPT_HISTORY = 10000;

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function validateAttemptPayload(attempt) {
  if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) throw new Error('attempt payload must be an object.');
  requiredString(attempt.attemptId, 'attempt.attemptId');
  requiredString(attempt.tenantId, 'attempt.tenantId');
  requiredString(attempt.actionId, 'attempt.actionId');
  if (!/^[0-9a-f]{64}$/.test(attempt.actionHash || '')) throw new Error('attempt.actionHash must be SHA-256 hex.');
  if (!Number.isInteger(attempt.attemptNumber) || attempt.attemptNumber < 1) throw new Error('attempt.attemptNumber must be positive.');
  requiredString(attempt.idempotencyKey, 'attempt.idempotencyKey');
  if (!Object.values(EXECUTION_ATTEMPT_STATES).includes(attempt.state)) throw new Error('Invalid attempt.state.');
  return attempt;
}

function validateAttemptRecord(record, tenantId) {
  validateAttemptPayload(record.payload);
  if (
    record.tenantId !== tenantId ||
    record.payload.tenantId !== tenantId ||
    record.recordId !== record.payload.attemptId ||
    record.indexKey !== record.payload.actionId
  ) {
    throw new Error('DURABLE_EXECUTION_ATTEMPT_IDENTITY_MISMATCH');
  }
  return record;
}

function eventIdFor(attempt, revision) {
  return `execution-attempt:${attempt.attemptId}:revision:${revision}:${attempt.state}`;
}

function eventPayload(attempt) {
  return {
    attemptId: attempt.attemptId,
    actionId: attempt.actionId,
    actionHash: attempt.actionHash,
    attemptNumber: attempt.attemptNumber,
    state: attempt.state,
    externalExecutionId: attempt.externalExecutionId ?? null,
    reconciliationOutcome: attempt.reconciliation?.outcome ?? null
  };
}

function eventTypeFor(attempt) {
  return `growth.execution_attempt.${String(attempt.state).toLowerCase()}`;
}

export async function loadDurableExecutionAttempt({ store, tenantId, attemptId }) {
  requiredString(tenantId, 'tenantId');
  requiredString(attemptId, 'attemptId');
  const record = await store.getRecord({ tenantId, recordType: EXECUTION_ATTEMPT_RECORD_TYPE, recordId: attemptId });
  if (!record) return null;
  return validateAttemptRecord(record, tenantId);
}

export async function listDurableExecutionAttempts({ store, tenantId, actionId = null, limit = 1000 }) {
  requiredString(tenantId, 'tenantId');
  if (actionId !== null) requiredString(actionId, 'actionId');
  const records = await store.listRecords({
    tenantId,
    recordType: EXECUTION_ATTEMPT_RECORD_TYPE,
    indexKey: actionId,
    limit
  });
  return records.map(record => validateAttemptRecord(record, tenantId));
}

export async function createDurableExecutionAttempt({ store, action, maxAttempts = 1, now = new Date() }) {
  if (!action || typeof action !== 'object') throw new Error('action is required.');
  requiredString(action.tenantId, 'action.tenantId');
  requiredString(action.actionId, 'action.actionId');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_DURABLE_ATTEMPT_HISTORY) {
    throw new Error(`maxAttempts must be an integer between 1 and ${MAX_DURABLE_ATTEMPT_HISTORY}.`);
  }
  const existingRecords = await listDurableExecutionAttempts({
    store,
    tenantId: action.tenantId,
    actionId: action.actionId,
    limit: MAX_DURABLE_ATTEMPT_HISTORY
  });
  const existingAttempts = existingRecords.map(record => clone(record.payload));
  const attempt = createExecutionAttempt({ action, attempts: existingAttempts, maxAttempts, now });
  validateAttemptPayload(attempt);

  const result = await mutateAuthoritativeRuntimeState({
    store,
    tenantId: attempt.tenantId,
    recordType: EXECUTION_ATTEMPT_RECORD_TYPE,
    recordId: attempt.attemptId,
    indexKey: attempt.actionId,
    payload: attempt,
    expectedRevision: 0,
    now,
    event: {
      eventId: eventIdFor(attempt, 1),
      eventType: eventTypeFor(attempt),
      payload: eventPayload(attempt),
      correlationId: attempt.actionId
    }
  });
  return validateAttemptRecord(result.record, attempt.tenantId);
}

async function transition({ store, tenantId, attemptId, now = new Date(), apply }) {
  const current = await loadDurableExecutionAttempt({ store, tenantId, attemptId });
  if (!current) throw new Error('DURABLE_EXECUTION_ATTEMPT_NOT_FOUND');
  const nextAttempt = clone(current.payload);
  apply(nextAttempt);
  validateAttemptPayload(nextAttempt);
  if (nextAttempt.attemptId !== current.payload.attemptId || nextAttempt.actionId !== current.payload.actionId || nextAttempt.actionHash !== current.payload.actionHash) {
    throw new Error('DURABLE_EXECUTION_ATTEMPT_IDENTITY_CHANGED');
  }
  const nextRevision = current.revision + 1;
  const result = await mutateAuthoritativeRuntimeState({
    store,
    tenantId,
    recordType: EXECUTION_ATTEMPT_RECORD_TYPE,
    recordId: attemptId,
    indexKey: nextAttempt.actionId,
    payload: nextAttempt,
    expectedRevision: current.revision,
    now,
    event: {
      eventId: eventIdFor(nextAttempt, nextRevision),
      eventType: eventTypeFor(nextAttempt),
      payload: eventPayload(nextAttempt),
      correlationId: nextAttempt.actionId
    }
  });
  return validateAttemptRecord(result.record, tenantId);
}

export function markDurableExecutionSubmitting({ store, tenantId, attemptId, now = new Date() }) {
  return transition({ store, tenantId, attemptId, now, apply: attempt => markExecutionSubmitting(attempt, now) });
}

export function markDurableExecutionAccepted({ store, tenantId, attemptId, externalExecutionId = null, metadata = null, now = new Date() }) {
  return transition({
    store, tenantId, attemptId, now,
    apply: attempt => markExecutionAccepted(attempt, { externalExecutionId, metadata }, now)
  });
}

export function markDurableExecutionCompleted({ store, tenantId, attemptId, result = {}, now = new Date() }) {
  return transition({ store, tenantId, attemptId, now, apply: attempt => markExecutionCompleted(attempt, result, now) });
}

export function markDurableExecutionDefinitiveFailure({ store, tenantId, attemptId, error, now = new Date() }) {
  return transition({ store, tenantId, attemptId, now, apply: attempt => markExecutionDefinitiveFailure(attempt, error, now) });
}

export function markDurableExecutionNotAccepted({ store, tenantId, attemptId, evidence = null, now = new Date() }) {
  return transition({ store, tenantId, attemptId, now, apply: attempt => markExecutionNotAccepted(attempt, evidence, now) });
}

export function markDurableExecutionReconciliationRequired({ store, tenantId, attemptId, error, now = new Date() }) {
  return transition({ store, tenantId, attemptId, now, apply: attempt => markExecutionReconciliationRequired(attempt, error, now) });
}

export function reconcileDurableExecutionAttempt({ store, tenantId, attemptId, outcome, by, evidence, result = null, now = new Date() }) {
  return transition({
    store, tenantId, attemptId, now,
    apply: attempt => reconcileExecutionAttempt(attempt, { outcome, by, evidence, result }, now)
  });
}
