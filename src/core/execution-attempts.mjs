import crypto from 'node:crypto';
import { actionApprovalHash } from './canonical.mjs';

export const EXECUTION_ATTEMPT_STATES = Object.freeze({
  CREATED: 'CREATED',
  SUBMITTING: 'SUBMITTING',
  ACCEPTED: 'ACCEPTED',
  COMPLETED: 'COMPLETED',
  DEFINITIVE_FAILURE: 'DEFINITIVE_FAILURE',
  RECONCILIATION_REQUIRED: 'RECONCILIATION_REQUIRED',
  RECONCILED_COMPLETED: 'RECONCILED_COMPLETED',
  RECONCILED_FAILED: 'RECONCILED_FAILED',
  NOT_ACCEPTED: 'NOT_ACCEPTED'
});

const UNRESOLVED_STATES = new Set([
  EXECUTION_ATTEMPT_STATES.CREATED,
  EXECUTION_ATTEMPT_STATES.SUBMITTING,
  EXECUTION_ATTEMPT_STATES.ACCEPTED,
  EXECUTION_ATTEMPT_STATES.RECONCILIATION_REQUIRED
]);

function nowIso(now = new Date()) {
  const value = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(value.getTime())) throw new Error('Invalid execution timestamp.');
  return value.toISOString();
}

function appendEvent(attempt, type, metadata = {}, now = new Date()) {
  const at = nowIso(now);
  attempt.updatedAt = at;
  attempt.events.push({
    eventId: crypto.randomUUID(),
    type,
    at,
    ...metadata
  });
}

function assertState(attempt, allowed, operation) {
  if (!allowed.includes(attempt.state)) {
    throw new Error(`${operation} not allowed from ${attempt.state}.`);
  }
}

export function hasUnresolvedExecutionAttempt(attempts = []) {
  return attempts.some(attempt => UNRESOLVED_STATES.has(attempt.state));
}

export function assertExecutionAttemptAvailable(attempts = [], maxAttempts = 1) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive integer.');
  if (hasUnresolvedExecutionAttempt(attempts)) throw new Error('RECONCILIATION_REQUIRED_BEFORE_NEW_ATTEMPT');
  if (attempts.length >= maxAttempts) throw new Error('EXECUTION_ATTEMPT_LIMIT_EXCEEDED');
  return true;
}

export function createExecutionAttempt({ action, attempts = [], maxAttempts = 1, now = new Date() }) {
  if (!action || typeof action !== 'object') throw new Error('action is required.');
  if (!action.tenantId || !action.actionId) throw new Error('action tenantId and actionId are required.');
  assertExecutionAttemptAvailable(attempts, maxAttempts);

  const attemptNumber = attempts.length + 1;
  const actionHash = actionApprovalHash(action);
  const createdAt = nowIso(now);
  const attemptId = crypto.randomUUID();
  const attempt = {
    schemaVersion: 1,
    attemptId,
    tenantId: action.tenantId,
    actionId: action.actionId,
    actionHash,
    attemptNumber,
    idempotencyKey: `growthos:${action.tenantId}:${action.actionId}:${actionHash}:attempt:${attemptNumber}`,
    state: EXECUTION_ATTEMPT_STATES.CREATED,
    createdAt,
    updatedAt: createdAt,
    externalExecutionId: null,
    result: null,
    error: null,
    reconciliation: null,
    events: []
  };
  appendEvent(attempt, 'EXECUTION_ATTEMPT_CREATED', { actionHash }, now);
  return attempt;
}

export function markExecutionSubmitting(attempt, now = new Date()) {
  assertState(attempt, [EXECUTION_ATTEMPT_STATES.CREATED], 'markExecutionSubmitting');
  attempt.state = EXECUTION_ATTEMPT_STATES.SUBMITTING;
  appendEvent(attempt, 'EXECUTION_SUBMITTING', {}, now);
  return attempt;
}

export function markExecutionAccepted(attempt, { externalExecutionId = null, metadata = null } = {}, now = new Date()) {
  assertState(attempt, [EXECUTION_ATTEMPT_STATES.SUBMITTING], 'markExecutionAccepted');
  attempt.state = EXECUTION_ATTEMPT_STATES.ACCEPTED;
  attempt.externalExecutionId = externalExecutionId;
  appendEvent(attempt, 'EXECUTION_ACCEPTED', { externalExecutionId, metadata }, now);
  return attempt;
}

export function markExecutionCompleted(attempt, result = {}, now = new Date()) {
  assertState(attempt, [EXECUTION_ATTEMPT_STATES.SUBMITTING, EXECUTION_ATTEMPT_STATES.ACCEPTED], 'markExecutionCompleted');
  attempt.state = EXECUTION_ATTEMPT_STATES.COMPLETED;
  attempt.result = result;
  appendEvent(attempt, 'EXECUTION_COMPLETED', { result }, now);
  return attempt;
}

export function markExecutionDefinitiveFailure(attempt, error, now = new Date()) {
  assertState(attempt, [EXECUTION_ATTEMPT_STATES.SUBMITTING, EXECUTION_ATTEMPT_STATES.ACCEPTED], 'markExecutionDefinitiveFailure');
  attempt.state = EXECUTION_ATTEMPT_STATES.DEFINITIVE_FAILURE;
  attempt.error = { message: String(error?.message || error || 'Execution failed') };
  appendEvent(attempt, 'EXECUTION_DEFINITIVE_FAILURE', { error: attempt.error }, now);
  return attempt;
}

export function markExecutionNotAccepted(attempt, evidence = null, now = new Date()) {
  assertState(attempt, [EXECUTION_ATTEMPT_STATES.SUBMITTING], 'markExecutionNotAccepted');
  attempt.state = EXECUTION_ATTEMPT_STATES.NOT_ACCEPTED;
  attempt.error = { message: 'Execution authority/provider definitively did not accept the request.' };
  appendEvent(attempt, 'EXECUTION_NOT_ACCEPTED', { evidence }, now);
  return attempt;
}

export function markExecutionReconciliationRequired(attempt, error, now = new Date()) {
  assertState(attempt, [EXECUTION_ATTEMPT_STATES.SUBMITTING, EXECUTION_ATTEMPT_STATES.ACCEPTED], 'markExecutionReconciliationRequired');
  attempt.state = EXECUTION_ATTEMPT_STATES.RECONCILIATION_REQUIRED;
  attempt.error = { message: String(error?.message || error || 'Execution outcome unknown') };
  appendEvent(attempt, 'EXECUTION_RECONCILIATION_REQUIRED', {
    externalExecutionId: attempt.externalExecutionId,
    error: attempt.error
  }, now);
  return attempt;
}

export function reconcileExecutionAttempt(attempt, { outcome, by, evidence, result = null } = {}, now = new Date()) {
  assertState(attempt, [EXECUTION_ATTEMPT_STATES.RECONCILIATION_REQUIRED], 'reconcileExecutionAttempt');
  if (!['COMPLETED', 'FAILED', 'NOT_ACCEPTED'].includes(outcome)) throw new Error('Invalid reconciliation outcome.');
  if (typeof by !== 'string' || !by.trim()) throw new Error('reconciliation.by is required.');
  if (typeof evidence !== 'string' || !evidence.trim()) throw new Error('reconciliation.evidence is required.');

  attempt.reconciliation = {
    outcome,
    by,
    evidence,
    reconciledAt: nowIso(now)
  };

  if (outcome === 'COMPLETED') {
    attempt.state = EXECUTION_ATTEMPT_STATES.RECONCILED_COMPLETED;
    attempt.result = result || {};
  } else {
    attempt.state = EXECUTION_ATTEMPT_STATES.RECONCILED_FAILED;
  }

  appendEvent(attempt, 'EXECUTION_RECONCILED', { outcome, by, evidence }, now);
  return attempt;
}

export function classifyUnexpectedExecutionError(error) {
  if (error?.definitiveFailure === true) return 'DEFINITIVE_FAILURE';
  if (error?.notAccepted === true) return 'NOT_ACCEPTED';
  return 'RECONCILIATION_REQUIRED';
}
