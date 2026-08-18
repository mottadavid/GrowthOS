import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import {
  createDurableExperiment,
  loadDurableExperiment,
  listDurableExperiments,
  approveDurableExperiment,
  startDurableExperiment,
  markDurableExperimentObserving,
  evaluateDurableExperiment,
  evaluateAndCloseDurableExperiment,
  markDurableExperimentReconciliationRequired
} from '../src/runtime/experiment-repository.mjs';

const PLAN_HASH = 'a'.repeat(64);
const T0 = new Date('2026-08-18T20:00:00.000Z');

function input(overrides = {}) {
  return {
    experimentId: 'exp-1',
    tenantId: 'tenant-1',
    opportunityId: 'opp-1',
    businessSnapshotId: 'snapshot-1',
    hypothesis: 'A bounded dormant-lead reactivation will produce booked appointments at an acceptable rate.',
    actionPlanRef: 'plan-1',
    actionPlanHash: PLAN_HASH,
    primaryMetric: 'booking_rate',
    successCriterion: { operator: 'GTE', threshold: 0.05 },
    guardrails: [{ metric: 'opt_out_rate', operator: 'GTE', threshold: 0.1 }],
    minimumSampleSize: 50,
    observationHorizonHours: 72,
    maxExposure: 200,
    maxSpendUsd: 100,
    createdAt: T0,
    ...overrides
  };
}

function observation(overrides = {}) {
  return {
    sampleSize: 50,
    exposure: 100,
    spendUsd: 25,
    metrics: { booking_rate: 0.06, opt_out_rate: 0.01 },
    evidenceRefs: ['growth://event/booking-summary-1'],
    ...overrides
  };
}

async function running(store) {
  const created = await createDurableExperiment({ store, input: input(), now: T0 });
  const approved = await approveDurableExperiment({
    store,
    tenantId: 'tenant-1',
    experimentId: created.record.recordId,
    actorId: 'owner-1',
    approvalAuthorityRef: 'wiserr://authority/owner-1/experiment-approval',
    now: new Date('2026-08-18T20:01:00Z')
  });
  return startDurableExperiment({
    store,
    tenantId: 'tenant-1',
    experimentId: approved.recordId,
    now: new Date('2026-08-18T20:02:00Z')
  });
}

test('creation is idempotent and recoverable by exact action-plan hash', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const first = await createDurableExperiment({ store, input: input(), now: T0 });
  const second = await createDurableExperiment({ store, input: input(), now: T0 });
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.record.indexKey, PLAN_HASH);

  const byPlan = await listDurableExperiments({ store, tenantId: 'tenant-1', actionPlanHash: PLAN_HASH });
  assert.equal(byPlan.length, 1);
  assert.equal(byPlan[0].recordId, 'exp-1');
});

test('same experiment ID cannot be reused for a different hypothesis', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await createDurableExperiment({ store, input: input(), now: T0 });
  await assert.rejects(
    () => createDurableExperiment({ store, input: input({ hypothesis: 'Different hypothesis' }), now: T0 }),
    /DURABLE_EXPERIMENT_ID_CONFLICT/
  );
});

test('approval authority provenance and approved hash survive restart recovery', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const created = await createDurableExperiment({ store, input: input(), now: T0 });
  assert.throws(
    () => approveDurableExperiment({ store, tenantId: 'tenant-1', experimentId: created.record.recordId, actorId: 'owner-1', approvalAuthorityRef: '' }),
    /approvalAuthorityRef/
  );
  const approved = await approveDurableExperiment({
    store,
    tenantId: 'tenant-1',
    experimentId: created.record.recordId,
    actorId: 'owner-1',
    approvalAuthorityRef: 'wiserr://authority/owner-1/experiment-approval',
    now: new Date('2026-08-18T20:01:00Z')
  });
  const recovered = await loadDurableExperiment({ store, tenantId: 'tenant-1', experimentId: approved.recordId });
  assert.equal(recovered.payload.state, 'APPROVED');
  assert.equal(recovered.payload.approvalAuthorityRef, 'wiserr://authority/owner-1/experiment-approval');
  assert.match(recovered.payload.approvalHash, /^[0-9a-f]{64}$/);
});

test('early promising data does not mutate or close the durable experiment', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const started = await running(store);
  const result = await evaluateAndCloseDurableExperiment({
    store,
    tenantId: 'tenant-1',
    experimentId: started.recordId,
    observation: observation({ sampleSize: 25 }),
    now: new Date('2026-08-22T20:00:00Z')
  });
  assert.equal(result.closed, false);
  assert.equal(result.evaluation.decision, 'CONTINUE');
  const recovered = await loadDurableExperiment({ store, tenantId: 'tenant-1', experimentId: started.recordId });
  assert.equal(recovered.payload.state, 'RUNNING');
});

test('guardrail breach closes durably before the observation horizon', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const started = await running(store);
  const result = await evaluateAndCloseDurableExperiment({
    store,
    tenantId: 'tenant-1',
    experimentId: started.recordId,
    observation: observation({ spendUsd: 101 }),
    now: new Date('2026-08-18T21:00:00Z')
  });
  assert.equal(result.closed, true);
  assert.equal(result.evaluation.decision, 'STOP_GUARDRAIL');
  assert.equal(result.record.payload.state, 'STOPPED');
  assert.deepEqual(result.record.payload.closeEvidenceRefs, ['growth://event/booking-summary-1']);
});

test('successful close is evidence-backed and survives restart', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const started = await running(store);
  await markDurableExperimentObserving({ store, tenantId: 'tenant-1', experimentId: started.recordId, now: new Date('2026-08-18T20:03:00Z') });
  const result = await evaluateAndCloseDurableExperiment({
    store,
    tenantId: 'tenant-1',
    experimentId: started.recordId,
    observation: observation(),
    now: new Date('2026-08-22T20:03:00Z')
  });
  assert.equal(result.evaluation.decision, 'SUCCESS');
  assert.equal(result.record.payload.state, 'COMPLETED');
  const recovered = await loadDurableExperiment({ store, tenantId: 'tenant-1', experimentId: started.recordId });
  assert.equal(recovered.payload.closeDecision, 'SUCCESS');
  assert.deepEqual(recovered.payload.closeEvidenceRefs, ['growth://event/booking-summary-1']);

  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: started.recordId });
  const completed = events.find(event => event.eventType === 'growth.experiment.completed');
  assert.ok(completed);
  assert.deepEqual(completed.payload.evidenceRefs, ['growth://event/booking-summary-1']);
  assert.equal(JSON.stringify(completed).includes('bounded dormant-lead reactivation'), false);
});

test('reconciliation state survives restart and blocks further evaluation', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const started = await running(store);
  const uncertain = await markDurableExperimentReconciliationRequired({
    store,
    tenantId: 'tenant-1',
    experimentId: started.recordId,
    reason: 'provider acceptance state unresolved',
    now: new Date('2026-08-18T20:03:00Z')
  });
  assert.equal(uncertain.payload.state, 'RECONCILIATION_REQUIRED');
  const recovered = await loadDurableExperiment({ store, tenantId: 'tenant-1', experimentId: started.recordId });
  await assert.rejects(
    () => evaluateDurableExperiment({ store, tenantId: 'tenant-1', experimentId: recovered.recordId, observation: observation(), now: new Date('2026-08-22T20:00:00Z') }),
    /EXPERIMENT_NOT_RUNNING/
  );
});

test('corrupt recovery index fails closed', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const created = await createDurableExperiment({ store, input: input(), now: T0 });
  const key = store.recordKey({ tenantId: 'tenant-1', recordType: 'experiment', recordId: created.record.recordId });
  store.records.get(key).indexKey = 'b'.repeat(64);
  await assert.rejects(
    () => loadDurableExperiment({ store, tenantId: 'tenant-1', experimentId: created.record.recordId }),
    /DURABLE_EXPERIMENT_IDENTITY_MISMATCH/
  );
});
