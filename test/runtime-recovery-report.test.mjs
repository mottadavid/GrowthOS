import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import { buildTenantRecoveryReport } from '../src/runtime/recovery-report.mjs';

const NOW = new Date('2026-08-18T22:00:00.000Z');

async function put(store, recordType, recordId, payload) {
  return store.putRecord({ tenantId: 'tenant-1', recordType, recordId, payload, expectedRevision: 0, now: NOW });
}

function commandPayload({ attemptId = 'attempt-1', actionId = 'action-1', campaignId = 'campaign-1' } = {}) {
  return { command: { commandId: `command-${actionId}`, attemptId, actionId, campaignId, commandHash: 'a'.repeat(64) } };
}

test('terminal tenant runtime state is safe for unattended recovery inspection', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await put(store, 'execution_attempt', 'attempt-1', { state: 'COMPLETED', actionId: 'action-1' });
  await put(store, 'reactivation_campaign', 'campaign-1', { status: 'COMPLETED', attemptIds: ['attempt-1'] });
  await put(store, 'experiment', 'experiment-1', { state: 'COMPLETED' });
  await put(store, 'action_envelope', 'envelope-1', { status: 'REVOKED', validUntil: '2026-08-18T21:00:00.000Z' });
  const report = await buildTenantRecoveryReport({ store, tenantId: 'tenant-1', now: NOW });
  assert.equal(report.mode, 'READ_ONLY');
  assert.equal(report.safeForUnattendedRecovery, true);
  assert.equal(report.requiresHumanOrDeterministicRevalidation, false);
  assert.equal(report.summary.findingCount, 0);
});

test('created attempt survives restart as revalidation work and is never auto-resumed', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await put(store, 'execution_attempt', 'attempt-1', { state: 'CREATED', actionId: 'action-1' });
  const report = await buildTenantRecoveryReport({ store, tenantId: 'tenant-1', now: NOW });
  assert.equal(report.safeForUnattendedRecovery, false);
  assert.equal(report.summary.unresolvedAttemptCount, 1);
  assert.equal(report.findings[0].code, 'ATTEMPT_CREATED_REVALIDATE_BEFORE_SUBMIT');
});

test('persisted command with pristine attempt is explicit revalidation work and never auto-submitted', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await put(store, 'execution_attempt', 'attempt-1', { state: 'CREATED', actionId: 'action-1' });
  await put(store, 'wiserr_reactivation_command', 'command-action-1', commandPayload());
  const report = await buildTenantRecoveryReport({ store, tenantId: 'tenant-1', now: NOW });
  assert.equal(report.safeForUnattendedRecovery, false);
  assert.equal(report.summary.persistedCommandFindingCount, 1);
  assert.ok(report.findings.some(item => item.code === 'PERSISTED_COMMAND_REVALIDATE_BEFORE_SUBMIT'));
});

test('persisted command without matching durable attempt is blocking', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await put(store, 'wiserr_reactivation_command', 'command-action-1', commandPayload({ attemptId: 'missing-attempt' }));
  const report = await buildTenantRecoveryReport({ store, tenantId: 'tenant-1', now: NOW });
  assert.equal(report.safeForUnattendedRecovery, false);
  assert.ok(report.findings.some(item => item.code === 'PERSISTED_COMMAND_WITHOUT_MATCHING_ATTEMPT' && item.severity === 'BLOCKING'));
});

test('submitting accepted and reconciliation-required attempts are blocking', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  for (const [id, state] of [['a1', 'SUBMITTING'], ['a2', 'ACCEPTED'], ['a3', 'RECONCILIATION_REQUIRED']]) await put(store, 'execution_attempt', id, { state, actionId: `action-${id}` });
  const report = await buildTenantRecoveryReport({ store, tenantId: 'tenant-1', now: NOW });
  assert.equal(report.summary.blockingCount, 3);
  assert.equal(report.safeForUnattendedRecovery, false);
  assert.deepEqual(new Set(report.findings.map(item => item.code)), new Set(['ATTEMPT_SUBMITTING_OUTCOME_UNKNOWN','ATTEMPT_ACCEPTED_NOT_FINAL','ATTEMPT_RECONCILIATION_REQUIRED']));
});

test('persisted command tied to unresolved external attempt remains blocking', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await put(store, 'execution_attempt', 'attempt-1', { state: 'SUBMITTING', actionId: 'action-1' });
  await put(store, 'wiserr_reactivation_command', 'command-action-1', commandPayload());
  const report = await buildTenantRecoveryReport({ store, tenantId: 'tenant-1', now: NOW });
  assert.ok(report.findings.some(item => item.code === 'PERSISTED_COMMAND_EXTERNAL_OUTCOME_UNRESOLVED' && item.severity === 'BLOCKING'));
});

test('campaign and experiment reconciliation state remains blocking after restart', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await put(store, 'reactivation_campaign', 'campaign-1', { status: 'RECONCILIATION_REQUIRED', attemptIds: ['attempt-1'] });
  await put(store, 'experiment', 'experiment-1', { state: 'RECONCILIATION_REQUIRED' });
  const report = await buildTenantRecoveryReport({ store, tenantId: 'tenant-1', now: NOW });
  assert.equal(report.summary.blockingCount, 2);
  assert.equal(report.safeForUnattendedRecovery, false);
});

test('approved/observing work and expired-but-still-active envelope require deterministic revalidation', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await put(store, 'reactivation_campaign', 'campaign-1', { status: 'APPROVED', attemptIds: [] });
  await put(store, 'experiment', 'experiment-1', { state: 'OBSERVING' });
  await put(store, 'action_envelope', 'envelope-1', { status: 'ACTIVE', validUntil: '2026-08-18T21:00:00.000Z' });
  const report = await buildTenantRecoveryReport({ store, tenantId: 'tenant-1', now: NOW });
  assert.equal(report.summary.blockingCount, 0);
  assert.equal(report.summary.attentionCount, 3);
  assert.equal(report.safeForUnattendedRecovery, false);
});

test('potentially truncated recovery coverage refuses to declare recovery safe', async () => {
  const tenThousandTerminal = Array.from({ length: 10000 }, (_, index) => ({ recordId: `attempt-${index}`, payload: { state: 'COMPLETED', actionId: `action-${index}` } }));
  const calls = [];
  const store = { async listRecords(args) { calls.push(args); return args.recordType === 'execution_attempt' ? tenThousandTerminal : []; } };
  const report = await buildTenantRecoveryReport({ store, tenantId: 'tenant-1', now: NOW });
  assert.equal(report.safeForUnattendedRecovery, false);
  assert.deepEqual(report.coverage.potentiallyTruncatedRecordTypes, ['execution_attempt']);
  assert.equal(calls.every(call => call.tenantId === 'tenant-1' && call.limit === 10000), true);
});

test('report is read-only and requires only tenant-scoped record listing', async () => {
  let calls = 0;
  const store = {
    async listRecords({ tenantId, recordType }) {
      calls += 1;
      assert.equal(tenantId, 'tenant-1');
      assert.ok(['execution_attempt', 'wiserr_reactivation_command', 'reactivation_campaign', 'experiment', 'action_envelope'].includes(recordType));
      return [];
    }
  };
  const report = await buildTenantRecoveryReport({ store, tenantId: 'tenant-1', now: NOW });
  assert.equal(calls, 5);
  assert.equal(report.safeForUnattendedRecovery, true);
});
