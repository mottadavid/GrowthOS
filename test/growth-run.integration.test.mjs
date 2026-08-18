import test from 'node:test';
import assert from 'node:assert/strict';
import { actionApprovalHash } from '../src/core/canonical.mjs';
import { evaluateActionPolicy } from '../src/core/control-plane.mjs';
import { createPolicyDecisionReceipt } from '../src/core/policy-receipts.mjs';
import { createDraftEnvelope, activateEnvelope } from '../src/core/envelope-lifecycle.mjs';
import { createExecutionAttempt, markExecutionSubmitting, markExecutionAccepted, markExecutionCompleted } from '../src/core/execution-attempts.mjs';
import { createOutcomeEvent } from '../src/core/growth-events.mjs';
import { createExperiment, approveExperiment } from '../src/core/experiments.mjs';
import { evaluateDormantLeadReactivation } from '../src/opportunities/reactivation.mjs';
import { toGrowthBusinessState } from '../src/integrations/wiserr/growth-snapshot.mjs';
import { buildReactivationPlan } from '../src/reactivation/plan.mjs';
import { createReactivationCampaign, submitReactivationCampaignForApproval, approveReactivationCampaign } from '../src/reactivation/campaign.mjs';
import { buildReactivationPolicyAction } from '../src/reactivation/action.mjs';
import { createGrowthRunManifest, validateGrowthRunManifest, assertGrowthRunManifestMatches } from '../src/core/growth-run.mjs';

const T0 = new Date('2026-08-18T20:00:00.000Z');

function snapshot() {
  return {
    schemaVersion: 1, snapshotId: 'snapshot-1', tenantId: 'tenant-1', generatedAt: T0.toISOString(), completeness: 'COMPLETE_FOR_PURPOSE',
    capacity: { status: 'AVAILABLE', demandThrottleRecommended: false, reason: null },
    reactivation: { cohortDefinitionId: 'non-won-inactive-leads', cohortDefinitionVersion: '1:90d', dormantCount: 120, eligibleByChannel: { sms: 100, email: 80, whatsapp: 70 }, suppressedCount: 20, latestRelevantActivityAt: '2026-05-01T00:00:00.000Z' },
    capabilities: { reactivationSms: true, reactivationEmail: false, reactivationWhatsapp: false, lunaReplyHandling: true, bookingOutcomes: true }
  };
}

function delegation() {
  return {
    schemaVersion: 1, assertionId: 'delegation-1', tenantId: 'tenant-1', grantingActorId: 'owner-1', issuerSystem: 'wiserr', issuerAuthorityRef: 'wiserr://authority/owner-1', status: 'ACTIVE',
    validFrom: '2026-08-18T19:00:00.000Z', validUntil: '2026-08-20T19:00:00.000Z', allowedDelegateSubjectIds: ['growth-strategist'], actionFamilies: ['REACTIVATION'], allowedAutonomyLevels: ['L3_APPROVAL_REQUIRED'],
    scopes: { channels: ['sms'], accountIds: ['wiserr-primary'], geographies: ['tampa-fl'] },
    limitCeilings: { maxSpendUsdPerDay: 100, maxSpendUsdTotal: 500, maxChangePercent: 25, maxAttempts: 1, maxRecipients: 200 },
    canActivateEnvelopes: true, canRevokeEnvelopes: true, evidenceRef: 'wiserr://authority/owner-1', notes: ''
  };
}

function buildLoop({ completeAttempt = true } = {}) {
  const snap = snapshot();
  const businessState = toGrowthBusinessState(snap);
  const opportunity = evaluateDormantLeadReactivation(businessState, { minDormantLeads: 25, now: T0 }).opportunity;
  const plan = buildReactivationPlan({ opportunity, snapshot: snap, channel: 'sms', message: { strategy: 'helpful_reactivation', body: 'PRIVATE MESSAGE BODY', version: 'v1' }, requestedMaxRecipients: 100, successMetric: 'BOOKING', observationHorizonHours: 72, maxAttempts: 1 });

  let campaign = createReactivationCampaign(plan, { campaignId: 'campaign-1', now: T0 });
  campaign = submitReactivationCampaignForApproval(campaign, { now: T0 });
  campaign = approveReactivationCampaign(campaign, { approvalId: 'approval-1', approvedBy: 'owner-1', approvedPlanHash: plan.approvalHash, approvedAt: T0, expiresAt: new Date('2026-08-19T20:00:00Z') });

  let experiment = createExperiment({ experimentId: 'experiment-1', tenantId: 'tenant-1', opportunityId: opportunity.opportunityId, businessSnapshotId: snap.snapshotId, hypothesis: 'Bounded reactivation can generate bookings without breaching opt-out guardrails.', actionPlanRef: plan.planId, actionPlanHash: plan.approvalHash, primaryMetric: 'booking_rate', successCriterion: { operator: 'GTE', threshold: 0.05 }, guardrails: [{ metric: 'opt_out_rate', operator: 'GTE', threshold: 0.1 }], minimumSampleSize: 50, observationHorizonHours: 72, maxExposure: 100, maxSpendUsd: 50, createdAt: T0 });
  experiment = approveExperiment(experiment, { actorId: 'owner-1', approvalAuthorityRef: 'wiserr://authority/owner-1/experiment', now: T0 });

  const action = buildReactivationPolicyAction({ plan, campaignApproval: campaign.approval, actionId: 'action-1', requestedBy: 'growth-strategist', experimentId: experiment.experimentId, accountId: 'wiserr-primary', geography: 'tampa-fl', expectedSpendUsd: 20, requestedAt: T0 });
  const draftEnvelope = createDraftEnvelope({ envelopeId: 'envelope-1', tenantId: 'tenant-1', actionFamily: 'REACTIVATION', delegateSubjectId: 'growth-strategist', autonomyLevel: 'L3_APPROVAL_REQUIRED', validFrom: '2026-08-18T19:00:00.000Z', validUntil: '2026-08-19T19:00:00.000Z', channels: ['sms'], accountIds: ['wiserr-primary'], geographies: ['tampa-fl'], limits: { maxSpendUsdPerDay: 50, maxSpendUsdTotal: 100, maxChangePercent: 10, maxAttempts: 1, maxRecipients: 100 }, requiresApproval: true, approvalId: campaign.approval.approvalId, approvedActionHash: actionApprovalHash(action) });
  const envelope = activateEnvelope({ envelope: draftEnvelope, assertion: delegation(), actorId: 'owner-1', now: T0 });
  const policyDecision = evaluateActionPolicy({ action, envelope, businessState, now: T0 });
  assert.equal(policyDecision.decision, 'ALLOW');
  const policyReceipt = createPolicyDecisionReceipt({ action, envelope, decision: policyDecision, evaluatedAt: T0 });

  const attempt = createExecutionAttempt({ action, maxAttempts: 1, now: T0 });
  markExecutionSubmitting(attempt, new Date('2026-08-18T20:01:00Z'));
  markExecutionAccepted(attempt, { externalExecutionId: 'wiserr-send-1' }, new Date('2026-08-18T20:02:00Z'));
  if (completeAttempt) markExecutionCompleted(attempt, { acceptedRecipients: 100 }, new Date('2026-08-18T20:03:00Z'));

  const outcome = createOutcomeEvent({ tenantId: 'tenant-1', correlationId: action.actionId, sourceSystem: 'wiserr', canonicalOutcomeId: 'booking-1', outcomeType: 'BOOKING', attributionConfidence: 'DIRECT', attributionEvidence: ['wiserr://booking/booking-1', 'growth://action/action-1'], directCorrelationId: action.actionId, occurredAt: new Date('2026-08-18T21:00:00Z') });
  return { snap, opportunity, campaign, experiment, envelope, action, attempt, policyReceipt, outcome };
}

function input(loop, overrides = {}) {
  return { runId: 'growth-run-1', snapshot: loop.snap, opportunity: loop.opportunity, campaign: loop.campaign, experiment: loop.experiment, envelope: loop.envelope, action: loop.action, attempt: loop.attempt, policyReceipt: loop.policyReceipt, outcomeEvents: [loop.outcome], ...overrides };
}

test('builds a privacy-safe manifest across the full first revenue-loop identity chain', () => {
  const loop = buildLoop();
  const manifest = createGrowthRunManifest(input(loop));
  assert.equal(validateGrowthRunManifest(manifest), manifest);
  assert.equal(manifest.tenantId, 'tenant-1');
  assert.equal(manifest.actionId, 'action-1');
  assert.equal(manifest.attemptState, 'COMPLETED');
  assert.equal(manifest.outcomeEventIds.length, 1);
  assert.equal(JSON.stringify(manifest).includes('PRIVATE MESSAGE BODY'), false);
});

test('manifest requires an exact policy receipt for an executed growth run', () => {
  const loop = buildLoop();
  assert.throws(() => createGrowthRunManifest(input(loop, { policyReceipt: null })), /policyReceipt is required/);
});

test('business outcomes cannot be attached before execution is known completed', () => {
  const loop = buildLoop({ completeAttempt: false });
  assert.equal(loop.attempt.state, 'ACCEPTED');
  assert.throws(() => createGrowthRunManifest(input(loop)), /OUTCOME_REQUIRES_SUCCESSFUL_EXECUTION/);
  const progressManifest = createGrowthRunManifest(input(loop, { outcomeEvents: [] }));
  assert.equal(progressManifest.attemptState, 'ACCEPTED');
});

test('manifest refuses cross-tenant, cross-snapshot and cross-action drift', () => {
  const loop = buildLoop();
  assert.throws(() => createGrowthRunManifest(input(loop, { opportunity: { ...loop.opportunity, tenantId: 'tenant-2' } })), /TENANT_MISMATCH/);
  assert.throws(() => createGrowthRunManifest(input(loop, { experiment: { ...loop.experiment, businessSnapshotId: 'other-snapshot' } })), /EXPERIMENT_SNAPSHOT_MISMATCH/);
  assert.throws(() => createGrowthRunManifest(input(loop, { attempt: { ...loop.attempt, actionHash: 'f'.repeat(64) } })), /ATTEMPT_ACTION_MISMATCH/);
});

test('stored manifest detects later source mutation at the earliest valid authority boundary', () => {
  const loop = buildLoop();
  const original = input(loop);
  const manifest = createGrowthRunManifest(original);
  assert.equal(assertGrowthRunManifestMatches(manifest, original), true);
  const changed = { ...original, action: { ...loop.action, geography: 'orlando-fl' } };
  assert.throws(() => assertGrowthRunManifestMatches(manifest, changed), /ATTEMPT_ACTION_MISMATCH|POLICY_RECEIPT_ACTION_CHANGED|SOURCE_CHANGED/);
});
