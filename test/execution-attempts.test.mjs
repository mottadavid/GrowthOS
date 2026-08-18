import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EXECUTION_ATTEMPT_STATES,
  assertExecutionAttemptAvailable,
  classifyUnexpectedExecutionError,
  createExecutionAttempt,
  hasUnresolvedExecutionAttempt,
  markExecutionAccepted,
  markExecutionCompleted,
  markExecutionDefinitiveFailure,
  markExecutionNotAccepted,
  markExecutionReconciliationRequired,
  markExecutionSubmitting,
  reconcileExecutionAttempt
} from '../src/core/execution-attempts.mjs';

function action(overrides = {}) {
  return {
    schemaVersion: 1,
    actionId: 'action-1',
    tenantId: 'tenant-1',
    actionFamily: 'REACTIVATION',
    actionType: 'SEND_REACTIVATION_SEQUENCE',
    channel: 'sms',
    accountId: 'wiserr-primary',
    geography: 'tampa-fl',
    requestedAt: '2026-08-18T19:00:00.000Z',
    requestedBy: 'growth-strategist',
    businessSnapshotId: 'snapshot-1',
    opportunityId: 'opp-1',
    experimentId: 'exp-1',
    inputs: { messageVersion: '1', cohortDefinition: 'dormant-90d' },
    expectedCost: { spendUsd: 10, recipients: 100 },
    currentTotalSpendUsd: 0,
    currentDailySpendUsd: 0,
    changePercent: 0,
    attemptNumber: 1,
    approvalId: 'approval-1',
    ...overrides
  };
}

test('creates deterministic idempotency identity bound to exact action hash', () => {
  const first = createExecutionAttempt({ action: action(), attempts: [], maxAttempts: 1, now: new Date('2026-08-18T19:00:00Z') });
  assert.match(first.actionHash, /^[0-9a-f]{64}$/);
  assert.equal(first.idempotencyKey, `growthos:tenant-1:action-1:${first.actionHash}:attempt:1`);

  const changed = createExecutionAttempt({
    action: action({ inputs: { messageVersion: '2', cohortDefinition: 'dormant-90d' } }),
    attempts: [],
    maxAttempts: 1,
    now: new Date('2026-08-18T19:00:00Z')
  });
  assert.notEqual(changed.actionHash, first.actionHash);
  assert.notEqual(changed.idempotencyKey, first.idempotencyKey);
});

test('blocks another attempt while prior outcome is unresolved', () => {
  const attempt = createExecutionAttempt({ action: action(), attempts: [], maxAttempts: 2 });
  markExecutionSubmitting(attempt);
  markExecutionReconciliationRequired(attempt, new Error('network timeout'));
  assert.equal(hasUnresolvedExecutionAttempt([attempt]), true);
  assert.throws(() => assertExecutionAttemptAvailable([attempt], 2), /RECONCILIATION_REQUIRED_BEFORE_NEW_ATTEMPT/);
});

test('accepted execution can complete with external execution ID retained', () => {
  const attempt = createExecutionAttempt({ action: action(), attempts: [], maxAttempts: 1 });
  markExecutionSubmitting(attempt);
  markExecutionAccepted(attempt, { externalExecutionId: 'provider-123' });
  markExecutionCompleted(attempt, { delivered: 97, suppressed: 3 });
  assert.equal(attempt.state, EXECUTION_ATTEMPT_STATES.COMPLETED);
  assert.equal(attempt.externalExecutionId, 'provider-123');
  assert.deepEqual(attempt.result, { delivered: 97, suppressed: 3 });
});

test('definitive failure is distinct from ambiguous failure', () => {
  const definitive = createExecutionAttempt({ action: action(), attempts: [], maxAttempts: 1 });
  markExecutionSubmitting(definitive);
  markExecutionDefinitiveFailure(definitive, new Error('request rejected before acceptance'));
  assert.equal(definitive.state, EXECUTION_ATTEMPT_STATES.DEFINITIVE_FAILURE);
  assert.equal(hasUnresolvedExecutionAttempt([definitive]), false);

  const ambiguous = createExecutionAttempt({ action: action(), attempts: [], maxAttempts: 1 });
  markExecutionSubmitting(ambiguous);
  markExecutionReconciliationRequired(ambiguous, new Error('socket closed after submit'));
  assert.equal(ambiguous.state, EXECUTION_ATTEMPT_STATES.RECONCILIATION_REQUIRED);
  assert.equal(hasUnresolvedExecutionAttempt([ambiguous]), true);
});

test('definitive not-accepted outcome permits a separately approved future attempt when ceiling allows', () => {
  const attempt = createExecutionAttempt({ action: action(), attempts: [], maxAttempts: 2 });
  markExecutionSubmitting(attempt);
  markExecutionNotAccepted(attempt, 'authority rejected before execution');
  assert.equal(attempt.state, EXECUTION_ATTEMPT_STATES.NOT_ACCEPTED);
  assert.equal(assertExecutionAttemptAvailable([attempt], 2), true);
});

test('reconciliation requires evidence and resolves ambiguity before another attempt', () => {
  const attempt = createExecutionAttempt({ action: action(), attempts: [], maxAttempts: 2 });
  markExecutionSubmitting(attempt);
  markExecutionAccepted(attempt, { externalExecutionId: 'provider-456' });
  markExecutionReconciliationRequired(attempt, new Error('result lookup failed'));

  assert.throws(() => reconcileExecutionAttempt(attempt, { outcome: 'COMPLETED', by: 'operator', evidence: '' }), /evidence is required/);

  reconcileExecutionAttempt(attempt, {
    outcome: 'COMPLETED',
    by: 'operator',
    evidence: 'Provider dashboard shows completed request provider-456',
    result: { delivered: 100 }
  });

  assert.equal(attempt.state, EXECUTION_ATTEMPT_STATES.RECONCILED_COMPLETED);
  assert.equal(hasUnresolvedExecutionAttempt([attempt]), false);
  assert.equal(assertExecutionAttemptAvailable([attempt], 2), true);
});

test('attempt ceiling remains independent from reconciliation state', () => {
  const attempt = createExecutionAttempt({ action: action(), attempts: [], maxAttempts: 1 });
  markExecutionSubmitting(attempt);
  markExecutionDefinitiveFailure(attempt, new Error('rejected'));
  assert.throws(() => assertExecutionAttemptAvailable([attempt], 1), /EXECUTION_ATTEMPT_LIMIT_EXCEEDED/);
});

test('unexpected errors default to reconciliation required', () => {
  assert.equal(classifyUnexpectedExecutionError(new Error('timeout')), 'RECONCILIATION_REQUIRED');
  assert.equal(classifyUnexpectedExecutionError({ definitiveFailure: true }), 'DEFINITIVE_FAILURE');
  assert.equal(classifyUnexpectedExecutionError({ notAccepted: true }), 'NOT_ACCEPTED');
});
