import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Canonical } from '../src/core/canonical.mjs';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import {
  validateWiserrSubmissionResult,
  ingestWiserrReactivationSubmissionResult,
  persistDurableWiserrSubmissionResult,
  loadDurableWiserrSubmissionResult,
  listDurableWiserrSubmissionResults
} from '../src/runtime/wiserr-submission-result-ingestion.mjs';
import { persistDurableWiserrReactivationCommand } from '../src/runtime/wiserr-reactivation-command-repository.mjs';
import { loadDurableExecutionAttempt } from '../src/runtime/execution-attempt-repository.mjs';
import { WISERR_REACTIVATION_SMS_DEPENDENCY_ID } from '../src/integrations/wiserr/reactivation-sms-authority.mjs';

const NOW = new Date('2026-08-18T20:00:00.000Z');

function executionRuntime(store, tenantId = 'tenant-1') {
  return Object.freeze({ schemaVersion: 1, tenantId, mode: 'EXECUTION_ENABLED', executionEnabled: true, executionBlockers: [], executionStore: store });
}

function command() {
  const body = {
    schemaVersion: 1,
    commandId: 'wiserr-reactivation:tenant-1:action-1:attempt:1', tenantId: 'tenant-1', actionId: 'action-1',
    actionHash: 'a'.repeat(64), campaignId: 'campaign-1', opportunityId: 'opp-1', experimentId: 'experiment-1',
    planId: 'plan-1', planApprovalHash: 'b'.repeat(64), campaignApprovalId: 'approval-1', policyReceiptId: 'policy-1',
    policyReceiptHash: 'c'.repeat(64), envelopeId: 'envelope-1', envelopeHash: 'd'.repeat(64), attemptId: 'attempt-1',
    attemptNumber: 1, idempotencyKey: 'growthos:tenant-1:action-1:attempt:1', capacityBundleId: 'capacity-bundle-1',
    capacityProofHash: 'e'.repeat(64), capacitySemanticHash: 'f'.repeat(64), capacityAuthorityHash: '1'.repeat(64),
    executionAuthorityDependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID, executionAuthorityLockFingerprint: '2'.repeat(64),
    originalBusinessSnapshotId: 'snapshot-original', executionBusinessSnapshotId: 'snapshot-execution',
    cohortDefinitionId: 'dormant-leads', cohortDefinitionVersion: 'v1', channel: 'sms', accountId: 'wiserr-primary',
    geography: 'tampa-fl', maxRecipients: 25,
    message: { strategy: 'return-help', body: 'PRIVATE CUSTOMER MESSAGE', version: 'v1' },
    frequencyPolicy: { maxAttempts: 1, minHoursBetweenAttempts: 24, stopOnReply: true, stopOnBooking: true, stopOnOptOut: true }
  };
  return { ...body, commandHash: sha256Canonical(body) };
}

function result(overrides = {}) {
  return {
    schemaVersion: 1, resultId: 'wiserr-result-1', tenantId: 'tenant-1',
    commandId: 'wiserr-reactivation:tenant-1:action-1:attempt:1', attemptId: 'attempt-1',
    outcome: 'ACCEPTED', classification: 'WISERR_ACCEPTED', evidenceRef: 'wiserr://messaging/execution/result-1',
    externalExecutionId: 'provider-message-1', observedAt: NOW.toISOString(), ...overrides
  };
}

async function setup() {
  const store = new AtomicInMemoryRuntimeStore();
  const cmd = command();
  await persistDurableWiserrReactivationCommand({ store, command: cmd, now: NOW });
  const attempt = {
    schemaVersion: 1, attemptId: cmd.attemptId, tenantId: cmd.tenantId, actionId: cmd.actionId, actionHash: cmd.actionHash,
    attemptNumber: cmd.attemptNumber, idempotencyKey: cmd.idempotencyKey, state: 'SUBMITTING',
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), externalExecutionId: null,
    result: null, error: null, suppression: null, reconciliation: null, events: []
  };
  await store.putRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: attempt.attemptId, indexKey: attempt.actionId, payload: attempt, expectedRevision: 0, now: NOW });
  return { store, runtime: executionRuntime(store) };
}

test('ACCEPTED persists exact evidence, advances the durable attempt, and exact redelivery is idempotent', async () => {
  const { store, runtime } = await setup();
  const inbound = result();
  const first = await ingestWiserrReactivationSubmissionResult({ runtime, result: inbound, now: NOW });
  assert.equal(first.idempotent, false);
  assert.equal(first.attemptRecord.payload.state, 'ACCEPTED');
  assert.equal(first.attemptRecord.payload.externalExecutionId, 'provider-message-1');
  const second = await ingestWiserrReactivationSubmissionResult({ runtime, result: structuredClone(inbound), now: new Date('2026-08-18T20:01:00Z') });
  assert.equal(second.idempotent, true);
  const receipts = await listDurableWiserrSubmissionResults({ store, tenantId: 'tenant-1', attemptId: 'attempt-1' });
  assert.equal(receipts.length, 1);
});

test('COMPLETED directly from SUBMITTING records acceptance then completion without losing external identity', async () => {
  const { runtime } = await setup();
  const inbound = result({ resultId: 'wiserr-result-completed', outcome: 'COMPLETED', classification: 'WISERR_COMPLETED' });
  const applied = await ingestWiserrReactivationSubmissionResult({ runtime, result: inbound, now: NOW });
  assert.equal(applied.attemptRecord.payload.state, 'COMPLETED');
  assert.equal(applied.attemptRecord.payload.externalExecutionId, 'provider-message-1');
  assert.equal(applied.attemptRecord.payload.result.resultId, inbound.resultId);
});

test('distinct COMPLETED result may follow an ACCEPTED result for the same attempt', async () => {
  const { runtime } = await setup();
  await ingestWiserrReactivationSubmissionResult({ runtime, result: result(), now: NOW });
  const completed = result({ resultId: 'wiserr-result-2', outcome: 'COMPLETED', classification: 'WISERR_COMPLETED', evidenceRef: 'wiserr://messaging/execution/result-2' });
  const applied = await ingestWiserrReactivationSubmissionResult({ runtime, result: completed, now: new Date('2026-08-18T20:02:00Z') });
  assert.equal(applied.attemptRecord.payload.state, 'COMPLETED');
});

test('SUPPRESSED becomes terminal suppression rather than provider failure', async () => {
  const { runtime } = await setup();
  const inbound = result({ resultId: 'wiserr-result-suppressed', outcome: 'SUPPRESSED', classification: 'RECIPIENT_OPTED_OUT', evidenceRef: 'wiserr://messaging/suppression/lead-1', externalExecutionId: null });
  const applied = await ingestWiserrReactivationSubmissionResult({ runtime, result: inbound, now: NOW });
  assert.equal(applied.attemptRecord.payload.state, 'SUPPRESSED');
  assert.equal(applied.attemptRecord.payload.suppression.classification, 'RECIPIENT_OPTED_OUT');
  assert.equal(applied.attemptRecord.payload.error, null);
});

test('AMBIGUOUS always enters reconciliation-required state', async () => {
  const { runtime } = await setup();
  const inbound = result({ resultId: 'wiserr-result-ambiguous', outcome: 'AMBIGUOUS', classification: 'TRANSPORT_OUTCOME_UNKNOWN', evidenceRef: 'wiserr://messaging/reconciliation/attempt-1', externalExecutionId: null });
  const applied = await ingestWiserrReactivationSubmissionResult({ runtime, result: inbound, now: NOW });
  assert.equal(applied.attemptRecord.payload.state, 'RECONCILIATION_REQUIRED');
});

test('same result ID with changed semantics conflicts', async () => {
  const { runtime } = await setup();
  const inbound = result();
  await ingestWiserrReactivationSubmissionResult({ runtime, result: inbound, now: NOW });
  await assert.rejects(
    () => ingestWiserrReactivationSubmissionResult({ runtime, result: { ...structuredClone(inbound), classification: 'CHANGED_CLASSIFICATION' }, now: NOW }),
    /DURABLE_WISERR_RESULT_CONFLICT/
  );
});

test('cross-command result is refused before receipt persistence', async () => {
  const { store, runtime } = await setup();
  await assert.rejects(
    () => ingestWiserrReactivationSubmissionResult({ runtime, result: result({ resultId: 'wrong-result', commandId: 'other-command' }), now: NOW }),
    /WISERR_SUBMISSION_RESULT_COMMAND_NOT_FOUND/
  );
  assert.equal(await loadDurableWiserrSubmissionResult({ store, tenantId: 'tenant-1', resultId: 'wrong-result' }), null);
});

test('crash after durable result receipt but before attempt transition can reapply exact evidence without contacting Wiserr again', async () => {
  const { store, runtime } = await setup();
  const inbound = result({ resultId: 'wiserr-result-crash-window' });
  const received = await persistDurableWiserrSubmissionResult({ store, result: inbound, now: NOW });
  assert.equal(received.idempotent, false);
  assert.equal((await loadDurableExecutionAttempt({ store, tenantId: 'tenant-1', attemptId: 'attempt-1' })).payload.state, 'SUBMITTING');
  const recovered = await ingestWiserrReactivationSubmissionResult({ runtime, result: inbound, now: new Date('2026-08-18T20:01:00Z') });
  assert.equal(recovered.idempotent, false);
  assert.equal(recovered.attemptRecord.payload.state, 'ACCEPTED');
});

test('result receipts are privacy-bounded and reject provider/message/recipient payloads', async () => {
  const { store, runtime } = await setup();
  await ingestWiserrReactivationSubmissionResult({ runtime, result: result(), now: NOW });
  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: 'attempt-1' });
  const receiptEvent = events.find(event => event.eventType === 'growth.wiserr_submission_result.received');
  assert.ok(receiptEvent);
  assert.equal(JSON.stringify(receiptEvent).includes('PRIVATE CUSTOMER MESSAGE'), false);
  for (const forbidden of [
    { providerPayload: { raw: 'secret' } },
    { message: 'private copy' },
    { recipient: '+15551234567' }
  ]) {
    assert.throws(() => validateWiserrSubmissionResult(result(forbidden)), /must not embed message, provider payload, or recipient data/);
  }
});
