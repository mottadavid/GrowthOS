import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Canonical } from '../src/core/canonical.mjs';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import { buildReactivationPlan } from '../src/reactivation/plan.mjs';
import {
  createDurableReactivationCampaign,
  submitDurableReactivationCampaignForApproval,
  approveDurableReactivationCampaign,
  startDurableReactivationCampaignFromPersistedCommand,
  markDurableReactivationCampaignObserving,
  loadDurableReactivationCampaign
} from '../src/runtime/reactivation-campaign-repository.mjs';
import {
  createDurableExperiment,
  approveDurableExperiment,
  startDurableExperiment,
  markDurableExperimentObserving,
  evaluateAndCloseDurableExperiment,
  loadDurableExperiment
} from '../src/runtime/experiment-repository.mjs';
import { persistDurableWiserrReactivationCommand } from '../src/runtime/wiserr-reactivation-command-repository.mjs';
import { evaluateReactivationObservationAndCloseCampaign } from '../src/runtime/reactivation-observation-close-coordinator.mjs';
import { WISERR_REACTIVATION_SMS_DEPENDENCY_ID } from '../src/integrations/wiserr/reactivation-sms-authority.mjs';

const T0 = new Date('2026-08-18T20:00:00.000Z');
const T1 = new Date('2026-08-18T21:00:00.000Z');
const T4 = new Date('2026-08-22T20:00:00.000Z');
function runtime(store) { return Object.freeze({ schemaVersion: 1, tenantId: 'tenant-1', mode: 'EXECUTION_ENABLED', executionEnabled: true, executionBlockers: [], executionStore: store }); }
function snapshot() { return { schemaVersion: 1, snapshotId: 'snapshot-1', tenantId: 'tenant-1', generatedAt: T0.toISOString(), completeness: 'PARTIAL', capacity: { status: 'UNKNOWN', demandThrottleRecommended: false }, reactivation: { cohortDefinitionId: 'dormant-leads', cohortDefinitionVersion: 'v1', dormantCount: 100, suppressedCount: 20, eligibleByChannel: { sms: 80, email: 0, whatsapp: 0 } }, capabilities: { reactivationSms: false, reactivationEmail: false, reactivationWhatsapp: false, lunaReplyHandling: false, bookingOutcomes: false } }; }
function observation(overrides = {}) { return { sampleSize: 50, exposure: 100, spendUsd: 25, metrics: { booking_rate: 0.06, opt_out_rate: 0.01 }, evidenceRefs: ['growth://event/booking-summary-1'], ...overrides }; }

async function setup({ experimentOpportunityId = 'opp-1' } = {}) {
  const store = new AtomicInMemoryRuntimeStore();
  const opportunity = { opportunityId: 'opp-1', tenantId: 'tenant-1', businessSnapshotId: 'snapshot-1', type: 'DORMANT_LEAD_REACTIVATION' };
  const plan = buildReactivationPlan({ opportunity, snapshot: snapshot(), channel: 'sms', message: { strategy: 'return-help', body: 'PRIVATE CUSTOMER MESSAGE', version: 'v1' }, requestedMaxRecipients: 50, maxAttempts: 1 });
  const created = await createDurableReactivationCampaign({ store, plan, now: T0 });
  const ready = await submitDurableReactivationCampaignForApproval({ store, tenantId: 'tenant-1', campaignId: created.record.recordId, now: T0 });
  const campaign = await approveDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: ready.recordId, approvalId: 'approval-1', approvedBy: 'owner-1', approvedPlanHash: plan.approvalHash, approvalAuthorityRef: 'wiserr://authority/owner-1/reactivation', approvedAt: T0 });

  const experimentCreated = await createDurableExperiment({ store, input: { experimentId: 'experiment-1', tenantId: 'tenant-1', opportunityId: experimentOpportunityId, businessSnapshotId: plan.businessSnapshotId, hypothesis: 'Reactivation produces booked appointments.', actionPlanRef: plan.planId, actionPlanHash: plan.approvalHash, primaryMetric: 'booking_rate', successCriterion: { operator: 'GTE', threshold: 0.05 }, guardrails: [{ metric: 'opt_out_rate', operator: 'GTE', threshold: 0.1 }], minimumSampleSize: 50, observationHorizonHours: 72, maxExposure: 200, maxSpendUsd: 100, createdAt: T0 }, now: T0 });
  await approveDurableExperiment({ store, tenantId: 'tenant-1', experimentId: 'experiment-1', actorId: 'owner-1', approvalAuthorityRef: 'wiserr://authority/owner-1/experiment', now: T0 });
  await startDurableExperiment({ store, tenantId: 'tenant-1', experimentId: 'experiment-1', now: T0 });

  const body = { schemaVersion: 1, commandId: 'wiserr-reactivation:tenant-1:action-1:attempt:1', tenantId: 'tenant-1', actionId: 'action-1', actionHash: 'a'.repeat(64), campaignId: campaign.recordId, opportunityId: plan.opportunityId, experimentId: 'experiment-1', planId: plan.planId, planApprovalHash: plan.approvalHash, campaignApprovalId: campaign.payload.approval.approvalId, policyReceiptId: 'policy-1', policyReceiptHash: 'b'.repeat(64), envelopeId: 'envelope-1', envelopeHash: 'c'.repeat(64), attemptId: 'attempt-1', attemptNumber: 1, idempotencyKey: 'growthos:tenant-1:action-1:attempt:1', capacityBundleId: 'capacity-1', capacityProofHash: 'd'.repeat(64), capacitySemanticHash: 'e'.repeat(64), capacityAuthorityHash: 'f'.repeat(64), executionAuthorityDependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID, executionAuthorityLockFingerprint: '1'.repeat(64), originalBusinessSnapshotId: plan.businessSnapshotId, executionBusinessSnapshotId: 'snapshot-execution-1', cohortDefinitionId: plan.cohort.definitionId, cohortDefinitionVersion: plan.cohort.definitionVersion, channel: 'sms', accountId: 'wiserr-primary', geography: 'tampa-fl', maxRecipients: 35, message: structuredClone(plan.message), frequencyPolicy: structuredClone(plan.frequencyPolicy) };
  const command = { ...body, commandHash: sha256Canonical(body) };
  await persistDurableWiserrReactivationCommand({ store, command, now: T0 });
  await startDurableReactivationCampaignFromPersistedCommand({ store, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: command.commandId, now: T0 });
  await markDurableReactivationCampaignObserving({ store, tenantId: 'tenant-1', campaignId: campaign.recordId, now: T1 });
  return { store, runtime: runtime(store), command, campaignId: campaign.recordId };
}

test('insufficient evidence keeps both experiment and campaign observing', async () => {
  const ctx = await setup();
  const result = await evaluateReactivationObservationAndCloseCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', commandId: ctx.command.commandId, observation: observation({ sampleSize: 10 }), now: T1 });
  assert.equal(result.closed, false);
  assert.equal(result.experimentDecision, 'CONTINUE');
  assert.equal(result.experimentState, 'OBSERVING');
  assert.equal(result.campaignState, 'OBSERVING');
});

test('evidence-backed SUCCESS closes experiment and campaign operationally', async () => {
  const ctx = await setup();
  const result = await evaluateReactivationObservationAndCloseCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', commandId: ctx.command.commandId, observation: observation(), now: T4 });
  assert.equal(result.closed, true);
  assert.equal(result.experimentDecision, 'SUCCESS');
  assert.equal(result.experimentState, 'COMPLETED');
  assert.equal(result.campaignState, 'COMPLETED');
  assert.deepEqual(result.evidenceRefs, ['growth://event/booking-summary-1']);
});

test('INCONCLUSIVE closes campaign without pretending experiment succeeded', async () => {
  const ctx = await setup();
  const result = await evaluateReactivationObservationAndCloseCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', commandId: ctx.command.commandId, observation: observation({ metrics: { opt_out_rate: 0.01 } }), now: T4 });
  assert.equal(result.experimentDecision, 'INCONCLUSIVE');
  assert.equal(result.experimentState, 'INCONCLUSIVE');
  assert.equal(result.campaignState, 'COMPLETED');
});

test('guardrail stop stops both experiment and campaign', async () => {
  const ctx = await setup();
  const result = await evaluateReactivationObservationAndCloseCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', commandId: ctx.command.commandId, observation: observation({ spendUsd: 101 }), now: T1 });
  assert.equal(result.experimentDecision, 'STOP_GUARDRAIL');
  assert.equal(result.experimentState, 'STOPPED');
  assert.equal(result.campaignState, 'STOPPED');
});

test('crash after experiment closes but before campaign transition resumes only campaign close', async () => {
  const ctx = await setup();
  await markDurableExperimentObserving({ store: ctx.store, tenantId: 'tenant-1', experimentId: 'experiment-1', now: T1 });
  await evaluateAndCloseDurableExperiment({ store: ctx.store, tenantId: 'tenant-1', experimentId: 'experiment-1', observation: observation(), now: T4 });
  assert.equal((await loadDurableReactivationCampaign({ store: ctx.store, tenantId: 'tenant-1', campaignId: ctx.campaignId })).payload.status, 'OBSERVING');
  const resumed = await evaluateReactivationObservationAndCloseCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', commandId: ctx.command.commandId, now: T4 });
  assert.equal(resumed.experimentState, 'COMPLETED');
  assert.equal(resumed.campaignState, 'COMPLETED');
  assert.equal(resumed.campaignTransitioned, true);
});

test('terminal replay is idempotent and does not require observation again', async () => {
  const ctx = await setup();
  await evaluateReactivationObservationAndCloseCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', commandId: ctx.command.commandId, observation: observation(), now: T4 });
  const replay = await evaluateReactivationObservationAndCloseCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', commandId: ctx.command.commandId, now: T4 });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.campaignTransitioned, false);
  assert.equal(replay.campaignState, 'COMPLETED');
});

test('command cannot bind an unrelated experiment into campaign learning', async () => {
  const ctx = await setup({ experimentOpportunityId: 'other-opportunity' });
  await assert.rejects(() => evaluateReactivationObservationAndCloseCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', commandId: ctx.command.commandId, observation: observation(), now: T4 }), /REACTIVATION_OBSERVATION_IDENTITY_MISMATCH/);
  assert.equal((await loadDurableExperiment({ store: ctx.store, tenantId: 'tenant-1', experimentId: 'experiment-1' })).payload.state, 'RUNNING');
});
