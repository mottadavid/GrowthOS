import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approveExperiment,
  assertExperimentIntegrity,
  closeExperiment,
  createExperiment,
  evaluateExperiment,
  experimentApprovalHash,
  markExperimentObserving,
  markExperimentReconciliationRequired,
  startExperiment
} from '../src/core/experiments.mjs';

const PLAN_HASH = 'a'.repeat(64);
const NOW = new Date('2026-08-18T21:00:00.000Z');

function draft(overrides = {}) {
  return createExperiment({
    experimentId: 'exp-1',
    tenantId: 'tenant-1',
    opportunityId: 'opp-1',
    businessSnapshotId: 'snap-1',
    hypothesis: 'Reactivating a bounded dormant cohort will produce booked appointments at an acceptable rate.',
    actionPlanRef: 'plan-1',
    actionPlanHash: PLAN_HASH,
    primaryMetric: 'booking_rate',
    successCriterion: { operator: 'GTE', threshold: 0.05 },
    guardrails: [{ metric: 'opt_out_rate', operator: 'GTE', threshold: 0.1 }],
    minimumSampleSize: 50,
    observationHorizonHours: 72,
    maxExposure: 200,
    maxSpendUsd: 100,
    createdAt: NOW,
    ...overrides
  });
}

function approved() {
  return approveExperiment(draft(), {
    actorId: 'owner-1',
    approvalAuthorityRef: 'wiserr://authority/owner-1/experiment-approval',
    now: NOW
  });
}

function running() {
  return startExperiment(approved(), { now: NOW });
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

test('approval binds the exact hypothesis, plan and evaluation policy', () => {
  const exp = approved();
  assert.match(exp.approvalHash, /^[0-9a-f]{64}$/);
  assert.equal(exp.approvalHash, experimentApprovalHash(exp));
  assert.equal(assertExperimentIntegrity(exp), true);
  const mutated = structuredClone(exp);
  mutated.maxExposure = 300;
  assert.throws(() => assertExperimentIntegrity(mutated), /APPROVED_EXPERIMENT_CHANGED/);
});

test('experiment approval requires an external authority reference', () => {
  assert.throws(() => approveExperiment(draft(), { actorId: 'owner-1', now: NOW }), /approvalAuthorityRef/);
});

test('does not peek early even when the current primary metric looks successful', () => {
  const exp = running();
  const result = evaluateExperiment(exp, observation({ sampleSize: 25 }), { now: new Date('2026-08-22T00:00:00Z') });
  assert.equal(result.decision, 'CONTINUE');
  assert.ok(result.reasons.includes('MINIMUM_EVIDENCE_NOT_REACHED'));

  const tooEarly = evaluateExperiment(exp, observation(), { now: new Date('2026-08-20T00:00:00Z') });
  assert.equal(tooEarly.decision, 'CONTINUE');
});

test('hard spend and exposure ceilings stop the experiment immediately', () => {
  const exp = running();
  const spend = evaluateExperiment(exp, observation({ spendUsd: 101 }), { now: new Date('2026-08-19T00:00:00Z') });
  assert.equal(spend.decision, 'STOP_GUARDRAIL');
  assert.ok(spend.reasons.includes('MAX_SPEND_EXCEEDED'));

  const exposure = evaluateExperiment(exp, observation({ exposure: 201 }), { now: new Date('2026-08-19T00:00:00Z') });
  assert.equal(exposure.decision, 'STOP_GUARDRAIL');
  assert.ok(exposure.reasons.includes('MAX_EXPOSURE_EXCEEDED'));
});

test('business guardrail can stop experiment before horizon', () => {
  const exp = running();
  const result = evaluateExperiment(exp, observation({ metrics: { booking_rate: 0.10, opt_out_rate: 0.11 } }), { now: new Date('2026-08-19T00:00:00Z') });
  assert.equal(result.decision, 'STOP_GUARDRAIL');
  assert.ok(result.reasons.includes('GUARDRAIL_TRIGGERED:opt_out_rate'));
});

test('success and failure are evaluated only after minimum evidence', () => {
  const exp = running();
  const success = evaluateExperiment(exp, observation(), { now: new Date('2026-08-22T00:00:00Z') });
  assert.equal(success.decision, 'SUCCESS');

  const failure = evaluateExperiment(exp, observation({ metrics: { booking_rate: 0.03, opt_out_rate: 0.01 } }), { now: new Date('2026-08-22T00:00:00Z') });
  assert.equal(failure.decision, 'FAILURE');
});

test('missing primary metric becomes inconclusive rather than guessed', () => {
  const exp = running();
  const result = evaluateExperiment(exp, observation({ metrics: { opt_out_rate: 0.01 } }), { now: new Date('2026-08-22T00:00:00Z') });
  assert.equal(result.decision, 'INCONCLUSIVE');
});

test('observations require evidence references from the growth/outcome ledger', () => {
  const exp = running();
  assert.throws(() => evaluateExperiment(exp, observation({ evidenceRefs: [] }), { now: new Date('2026-08-22T00:00:00Z') }), /evidenceRefs/);
});

test('closing an experiment retains exact evidence and deterministic decision', () => {
  const exp = markExperimentObserving(running());
  const evaluation = evaluateExperiment(exp, observation(), { now: new Date('2026-08-22T00:00:00Z') });
  const closed = closeExperiment(exp, evaluation, { now: new Date('2026-08-22T00:01:00Z') });
  assert.equal(closed.state, 'COMPLETED');
  assert.equal(closed.closeDecision, 'SUCCESS');
  assert.deepEqual(closed.closeEvidenceRefs, ['growth://event/booking-summary-1']);
});

test('ambiguous execution data moves experiment to reconciliation rather than a false close', () => {
  const exp = running();
  const reconciled = markExperimentReconciliationRequired(exp, 'provider acceptance state unresolved');
  assert.equal(reconciled.state, 'RECONCILIATION_REQUIRED');
  assert.throws(() => evaluateExperiment(reconciled, observation(), { now: new Date('2026-08-22T00:00:00Z') }), /EXPERIMENT_NOT_RUNNING/);
});
