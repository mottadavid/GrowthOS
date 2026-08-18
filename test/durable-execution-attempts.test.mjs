import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import {
  createDurableExecutionAttempt,
  loadDurableExecutionAttempt,
  listDurableExecutionAttempts,
  markDurableExecutionSubmitting,
  markDurableExecutionAccepted,
  markDurableExecutionCompleted,
  markDurableExecutionReconciliationRequired,
  reconcileDurableExecutionAttempt
} from '../src/runtime/execution-attempt-repository.mjs';

const T0 = new Date('2026-08-18T20:00:00.000Z');

function action(actionId = 'action-1') {
  return {
    schemaVersion: 1,
    actionId,
    tenantId: 'tenant-1',
    actionFamily: 'REACTIVATION',
    actionType: 'SEND_REACTIVATION_SEQUENCE',
    channel: 'sms',
    accountId: 'wiserr-primary',
    geography: 'tampa-fl',
    requestedAt: T0.toISOString(),
    requestedBy: 'growth-strategist',
    businessSnapshotId: 'snapshot-1',
    opportunityId: 'opp-1',
    experimentId: 'exp-1',
    inputs: { planId: 'plan-1', demandIncreasing: true },
    expectedCost: { spendUsd: 10, recipients: 100 },
    currentTotalSpendUsd: 0,
    currentDailySpendUsd: 0,
    changePercent: 0,
    attemptNumber: 1,
    approvalId: 'approval-1'
  };
}

test('durably creates an indexed attempt and recovers it by exact action', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const created = await createDurableExecutionAttempt({ store, action: action(), maxAttempts: 1, now: T0 });
  assert.equal(created.revision, 1);
  assert.equal(created.indexKey, 'action-1');
  assert.equal(created.payload.state, 'CREATED');

  const recovered = await loadDurableExecutionAttempt({ store, tenantId: 'tenant-1', attemptId: created.recordId });
  assert.equal(recovered.payload.actionId, 'action-1');

  const byAction = await listDurableExecutionAttempts({ store, tenantId: 'tenant-1', actionId: 'action-1' });
  assert.equal(byAction.length, 1);
  assert.equal(byAction[0].recordId, created.recordId);
});

test('restart-style recovery blocks another attempt while prior outcome is unresolved', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const first = await createDurableExecutionAttempt({ store, action: action(), maxAttempts: 2, now: T0 });
  await markDurableExecutionSubmitting({ store, tenantId: 'tenant-1', attemptId: first.recordId, now: new Date('2026-08-18T20:01:00Z') });
  await markDurableExecutionReconciliationRequired({
    store,
    tenantId: 'tenant-1',
    attemptId: first.recordId,
    error: new Error('transport timeout after submit'),
    now: new Date('2026-08-18T20:02:00Z')
  });

  await assert.rejects(
    () => createDurableExecutionAttempt({ store, action: action(), maxAttempts: 2, now: new Date('2026-08-18T20:03:00Z') }),
    /RECONCILIATION_REQUIRED_BEFORE_NEW_ATTEMPT/
  );
});

test('reconciliation must complete before a later attempt can be considered', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const first = await createDurableExecutionAttempt({ store, action: action(), maxAttempts: 2, now: T0 });
  await markDurableExecutionSubmitting({ store, tenantId: 'tenant-1', attemptId: first.recordId, now: new Date('2026-08-18T20:01:00Z') });
  await markDurableExecutionReconciliationRequired({
    store, tenantId: 'tenant-1', attemptId: first.recordId,
    error: 'unknown provider outcome', now: new Date('2026-08-18T20:02:00Z')
  });
  await reconcileDurableExecutionAttempt({
    store, tenantId: 'tenant-1', attemptId: first.recordId,
    outcome: 'NOT_ACCEPTED', by: 'operator-1', evidence: 'provider lookup showed no message',
    now: new Date('2026-08-18T20:03:00Z')
  });

  const second = await createDurableExecutionAttempt({
    store, action: action(), maxAttempts: 2, now: new Date('2026-08-18T20:04:00Z')
  });
  assert.equal(second.payload.attemptNumber, 2);
  assert.notEqual(second.recordId, first.recordId);
});

test('completed durable attempt remains recoverable with its external execution identity', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const created = await createDurableExecutionAttempt({ store, action: action(), maxAttempts: 1, now: T0 });
  await markDurableExecutionSubmitting({ store, tenantId: 'tenant-1', attemptId: created.recordId, now: new Date('2026-08-18T20:01:00Z') });
  await markDurableExecutionAccepted({
    store, tenantId: 'tenant-1', attemptId: created.recordId,
    externalExecutionId: 'wiserr-send-1', now: new Date('2026-08-18T20:02:00Z')
  });
  await markDurableExecutionCompleted({
    store, tenantId: 'tenant-1', attemptId: created.recordId,
    result: { acceptedRecipients: 100 }, now: new Date('2026-08-18T20:03:00Z')
  });

  const recovered = await loadDurableExecutionAttempt({ store, tenantId: 'tenant-1', attemptId: created.recordId });
  assert.equal(recovered.payload.state, 'COMPLETED');
  assert.equal(recovered.payload.externalExecutionId, 'wiserr-send-1');
});

test('action-scoped index ignores large unrelated tenant history', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const target = await createDurableExecutionAttempt({ store, action: action('target-action'), maxAttempts: 1, now: T0 });

  for (let i = 0; i < 1100; i += 1) {
    const unrelated = action(`other-${i}`);
    await createDurableExecutionAttempt({
      store,
      action: unrelated,
      maxAttempts: 1,
      now: new Date(T0.getTime() + (i + 1) * 1000)
    });
  }

  const targetHistory = await listDurableExecutionAttempts({ store, tenantId: 'tenant-1', actionId: 'target-action', limit: 10 });
  assert.equal(targetHistory.length, 1);
  assert.equal(targetHistory[0].recordId, target.recordId);

  await assert.rejects(
    () => createDurableExecutionAttempt({ store, action: action('target-action'), maxAttempts: 1, now: new Date('2026-08-18T21:00:00Z') }),
    /EXECUTION_ATTEMPT_LIMIT_EXCEEDED/
  );
});

test('unindexed or mismatched durable attempt records fail closed on recovery', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const created = await createDurableExecutionAttempt({ store, action: action(), maxAttempts: 1, now: T0 });
  const key = store.recordKey({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: created.recordId });
  store.records.get(key).indexKey = 'wrong-action';

  await assert.rejects(
    () => loadDurableExecutionAttempt({ store, tenantId: 'tenant-1', attemptId: created.recordId }),
    /DURABLE_EXECUTION_ATTEMPT_IDENTITY_MISMATCH/
  );
});
