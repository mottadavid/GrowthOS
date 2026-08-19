import { sha256Canonical } from '../core/canonical.mjs';
import { EXECUTION_ATTEMPT_STATES } from '../core/execution-attempts.mjs';
import { assertExecutionRuntime } from './bootstrap.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';
import {
  loadDurableExecutionAttempt,
  markDurableExecutionAccepted,
  markDurableExecutionCompleted,
  markDurableExecutionDefinitiveFailure,
  markDurableExecutionSuppressed,
  markDurableExecutionNotAccepted,
  markDurableExecutionReconciliationRequired
} from './execution-attempt-repository.mjs';
import { loadDurableWiserrReactivationCommand } from './wiserr-reactivation-command-repository.mjs';

export const WISERR_SUBMISSION_RESULT_RECORD_TYPE = 'wiserr_submission_result';
export const WISERR_SUBMISSION_OUTCOMES = Object.freeze([
  'ACCEPTED',
  'COMPLETED',
  'SUPPRESSED',
  'NOT_ACCEPTED',
  'DEFINITIVE_FAILURE',
  'AMBIGUOUS'
]);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value, label) {
  if (value === null || value === undefined) return null;
  return requiredString(value, label);
}

function validIso(value, label) {
  requiredString(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid date-time.`);
  return value;
}

function clone(value) { return structuredClone(value); }

export function validateWiserrSubmissionResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('result must be an object.');
  if (result.schemaVersion !== 1) throw new Error('Unsupported result.schemaVersion.');
  for (const field of ['resultId', 'tenantId', 'commandId', 'attemptId', 'classification', 'evidenceRef', 'observedAt']) {
    requiredString(result[field], `result.${field}`);
  }
  if (!WISERR_SUBMISSION_OUTCOMES.includes(result.outcome)) throw new Error('Invalid result.outcome.');
  validIso(result.observedAt, 'result.observedAt');
  optionalString(result.externalExecutionId, 'result.externalExecutionId');
  if (Object.hasOwn(result, 'message') || Object.hasOwn(result, 'providerPayload') || Object.hasOwn(result, 'recipient')) {
    throw new Error('Wiserr submission result must not embed message, provider payload, or recipient data.');
  }
  return result;
}

export function wiserrSubmissionResultSemanticHash(result) {
  validateWiserrSubmissionResult(result);
  return sha256Canonical(result);
}

function validateResultRecord(record, tenantId) {
  if (!record || typeof record !== 'object') throw new Error('durable Wiserr result record is required.');
  const payload = record.payload;
  if (!payload || payload.schemaVersion !== 1) throw new Error('Invalid durable Wiserr result payload.');
  validateWiserrSubmissionResult(payload.result);
  if (!/^[0-9a-f]{64}$/.test(payload.semanticHash || '')) throw new Error('payload.semanticHash must be SHA-256 hex.');
  if (wiserrSubmissionResultSemanticHash(payload.result) !== payload.semanticHash) throw new Error('DURABLE_WISERR_RESULT_SEMANTIC_HASH_MISMATCH');
  if (
    record.tenantId !== tenantId ||
    payload.result.tenantId !== tenantId ||
    record.recordId !== payload.result.resultId ||
    record.indexKey !== payload.result.attemptId
  ) {
    throw new Error('DURABLE_WISERR_RESULT_IDENTITY_MISMATCH');
  }
  return record;
}

export async function loadDurableWiserrSubmissionResult({ store, tenantId, resultId }) {
  requiredString(tenantId, 'tenantId');
  requiredString(resultId, 'resultId');
  const record = await store.getRecord({ tenantId, recordType: WISERR_SUBMISSION_RESULT_RECORD_TYPE, recordId: resultId });
  return record ? validateResultRecord(record, tenantId) : null;
}

export async function listDurableWiserrSubmissionResults({ store, tenantId, attemptId, limit = 1000 }) {
  requiredString(tenantId, 'tenantId');
  requiredString(attemptId, 'attemptId');
  const records = await store.listRecords({ tenantId, recordType: WISERR_SUBMISSION_RESULT_RECORD_TYPE, indexKey: attemptId, limit });
  return records.map(record => validateResultRecord(record, tenantId));
}

export async function persistDurableWiserrSubmissionResult({ store, result, now = new Date() }) {
  validateWiserrSubmissionResult(result);
  const semanticHash = wiserrSubmissionResultSemanticHash(result);
  const existing = await loadDurableWiserrSubmissionResult({ store, tenantId: result.tenantId, resultId: result.resultId });
  if (existing) {
    if (existing.payload.semanticHash !== semanticHash) throw new Error('DURABLE_WISERR_RESULT_CONFLICT');
    return { record: existing, idempotent: true };
  }

  const payload = { schemaVersion: 1, result: clone(result), semanticHash };
  try {
    const saved = await mutateAuthoritativeRuntimeState({
      store,
      tenantId: result.tenantId,
      recordType: WISERR_SUBMISSION_RESULT_RECORD_TYPE,
      recordId: result.resultId,
      indexKey: result.attemptId,
      payload,
      expectedRevision: 0,
      now,
      event: {
        eventId: `wiserr-submission-result:${result.resultId}`,
        eventType: 'growth.wiserr_submission_result.received',
        correlationId: result.attemptId,
        payload: {
          resultId: result.resultId,
          commandId: result.commandId,
          attemptId: result.attemptId,
          outcome: result.outcome,
          classification: result.classification,
          evidenceRef: result.evidenceRef,
          externalExecutionId: result.externalExecutionId ?? null,
          semanticHash
        }
      }
    });
    return { record: validateResultRecord(saved.record, result.tenantId), idempotent: false };
  } catch (error) {
    if (error?.code !== 'RUNTIME_RECORD_REVISION_CONFLICT') throw error;
    const raced = await loadDurableWiserrSubmissionResult({ store, tenantId: result.tenantId, resultId: result.resultId });
    if (!raced || raced.payload.semanticHash !== semanticHash) throw error;
    return { record: raced, idempotent: true };
  }
}

function assertCommandAttemptResultIdentity(command, attempt, result) {
  if (
    command.tenantId !== result.tenantId ||
    command.commandId !== result.commandId ||
    command.attemptId !== result.attemptId ||
    attempt.tenantId !== result.tenantId ||
    attempt.attemptId !== result.attemptId ||
    attempt.actionId !== command.actionId ||
    attempt.actionHash !== command.actionHash ||
    attempt.idempotencyKey !== command.idempotencyKey
  ) {
    throw new Error('WISERR_SUBMISSION_RESULT_IDENTITY_MISMATCH');
  }
}

function assertExternalExecutionIdentity(attempt, result) {
  const incoming = result.externalExecutionId ?? null;
  if (attempt.externalExecutionId && incoming && attempt.externalExecutionId !== incoming) {
    throw new Error('WISERR_SUBMISSION_RESULT_EXTERNAL_ID_MISMATCH');
  }
}

function historicalReplayAllowed(attempt, result, receiptWasIdempotent) {
  if (!receiptWasIdempotent) return false;
  if (result.outcome === 'ACCEPTED' && [EXECUTION_ATTEMPT_STATES.ACCEPTED, EXECUTION_ATTEMPT_STATES.COMPLETED, EXECUTION_ATTEMPT_STATES.RECONCILED_COMPLETED].includes(attempt.state)) return true;
  if (result.outcome === 'COMPLETED' && [EXECUTION_ATTEMPT_STATES.COMPLETED, EXECUTION_ATTEMPT_STATES.RECONCILED_COMPLETED].includes(attempt.state)) return true;
  if (result.outcome === 'SUPPRESSED' && attempt.state === EXECUTION_ATTEMPT_STATES.SUPPRESSED) return true;
  if (result.outcome === 'NOT_ACCEPTED' && attempt.state === EXECUTION_ATTEMPT_STATES.NOT_ACCEPTED) return true;
  if (result.outcome === 'DEFINITIVE_FAILURE' && attempt.state === EXECUTION_ATTEMPT_STATES.DEFINITIVE_FAILURE) return true;
  if (result.outcome === 'AMBIGUOUS' && attempt.state === EXECUTION_ATTEMPT_STATES.RECONCILIATION_REQUIRED) return true;
  return false;
}

export async function ingestWiserrReactivationSubmissionResult({ runtime, result, now = new Date() }) {
  validateWiserrSubmissionResult(result);
  if (runtime?.tenantId !== result.tenantId) throw new Error('WISERR_SUBMISSION_RESULT_RUNTIME_TENANT_MISMATCH');
  const store = assertExecutionRuntime(runtime);

  const commandRecord = await loadDurableWiserrReactivationCommand({ store, tenantId: result.tenantId, commandId: result.commandId });
  if (!commandRecord) throw new Error('WISERR_SUBMISSION_RESULT_COMMAND_NOT_FOUND');
  const command = commandRecord.payload.command;

  const attemptRecord = await loadDurableExecutionAttempt({ store, tenantId: result.tenantId, attemptId: result.attemptId });
  if (!attemptRecord) throw new Error('WISERR_SUBMISSION_RESULT_ATTEMPT_NOT_FOUND');
  assertCommandAttemptResultIdentity(command, attemptRecord.payload, result);
  assertExternalExecutionIdentity(attemptRecord.payload, result);

  const receipt = await persistDurableWiserrSubmissionResult({ store, result, now });
  let current = await loadDurableExecutionAttempt({ store, tenantId: result.tenantId, attemptId: result.attemptId });

  if (historicalReplayAllowed(current.payload, result, receipt.idempotent)) {
    assertExternalExecutionIdentity(current.payload, result);
    return { schemaVersion: 1, idempotent: true, resultRecord: receipt.record, attemptRecord: current };
  }

  if (result.outcome === 'ACCEPTED') {
    if (current.payload.state !== EXECUTION_ATTEMPT_STATES.SUBMITTING) throw new Error(`WISERR_SUBMISSION_RESULT_STATE_CONFLICT:${current.payload.state}`);
    current = await markDurableExecutionAccepted({
      store,
      tenantId: result.tenantId,
      attemptId: result.attemptId,
      externalExecutionId: result.externalExecutionId ?? null,
      metadata: { classification: result.classification, evidenceRef: result.evidenceRef, resultId: result.resultId },
      now
    });
  } else if (result.outcome === 'COMPLETED') {
    if (current.payload.state === EXECUTION_ATTEMPT_STATES.SUBMITTING) {
      current = await markDurableExecutionAccepted({
        store,
        tenantId: result.tenantId,
        attemptId: result.attemptId,
        externalExecutionId: result.externalExecutionId ?? null,
        metadata: { classification: 'COMPLETED_WITH_ACCEPTANCE', evidenceRef: result.evidenceRef, resultId: result.resultId },
        now
      });
    }
    if (current.payload.state !== EXECUTION_ATTEMPT_STATES.ACCEPTED) throw new Error(`WISERR_SUBMISSION_RESULT_STATE_CONFLICT:${current.payload.state}`);
    current = await markDurableExecutionCompleted({
      store,
      tenantId: result.tenantId,
      attemptId: result.attemptId,
      result: { classification: result.classification, evidenceRef: result.evidenceRef, resultId: result.resultId },
      now
    });
  } else if (result.outcome === 'SUPPRESSED') {
    if (current.payload.state !== EXECUTION_ATTEMPT_STATES.SUBMITTING) throw new Error(`WISERR_SUBMISSION_RESULT_STATE_CONFLICT:${current.payload.state}`);
    current = await markDurableExecutionSuppressed({ store, tenantId: result.tenantId, attemptId: result.attemptId, classification: result.classification, evidenceRef: result.evidenceRef, now });
  } else if (result.outcome === 'NOT_ACCEPTED') {
    if (current.payload.state !== EXECUTION_ATTEMPT_STATES.SUBMITTING) throw new Error(`WISERR_SUBMISSION_RESULT_STATE_CONFLICT:${current.payload.state}`);
    current = await markDurableExecutionNotAccepted({ store, tenantId: result.tenantId, attemptId: result.attemptId, evidence: result.evidenceRef, now });
  } else if (result.outcome === 'DEFINITIVE_FAILURE') {
    if (![EXECUTION_ATTEMPT_STATES.SUBMITTING, EXECUTION_ATTEMPT_STATES.ACCEPTED].includes(current.payload.state)) throw new Error(`WISERR_SUBMISSION_RESULT_STATE_CONFLICT:${current.payload.state}`);
    current = await markDurableExecutionDefinitiveFailure({ store, tenantId: result.tenantId, attemptId: result.attemptId, error: new Error(`${result.classification}:${result.evidenceRef}`), now });
  } else {
    if (![EXECUTION_ATTEMPT_STATES.SUBMITTING, EXECUTION_ATTEMPT_STATES.ACCEPTED].includes(current.payload.state)) throw new Error(`WISERR_SUBMISSION_RESULT_STATE_CONFLICT:${current.payload.state}`);
    current = await markDurableExecutionReconciliationRequired({ store, tenantId: result.tenantId, attemptId: result.attemptId, error: new Error(`${result.classification}:${result.evidenceRef}`), now });
  }

  return { schemaVersion: 1, idempotent: false, resultRecord: receipt.record, attemptRecord: current };
}
