import test from 'node:test';
import assert from 'node:assert/strict';
import { actionApprovalHash } from '../src/core/canonical.mjs';
import { evaluateActionPolicy } from '../src/core/control-plane.mjs';
import { createPolicyDecisionReceipt } from '../src/core/policy-receipts.mjs';
import { createDraftEnvelope, activateEnvelope } from '../src/core/envelope-lifecycle.mjs';
import { createExecutionAttempt, markExecutionSubmitting } from '../src/core/execution-attempts.mjs';
import { createExperiment, approveExperiment } from '../src/core/experiments.mjs';
import { evaluateDormantLeadReactivation } from '../src/opportunities/reactivation.mjs';
import { toGrowthBusinessState } from '../src/integrations/wiserr/growth-snapshot.mjs';
import { WISERR_REACTIVATION_SMS_DEPENDENCY_ID } from '../src/integrations/wiserr/reactivation-sms-authority.mjs';
import { buildReactivationPlan } from '../src/reactivation/plan.mjs';
import { buildReactivationPolicyAction } from '../src/reactivation/action.mjs';
import { createReactivationCampaign, submitReactivationCampaignForApproval, approveReactivationCampaign } from '../src/reactivation/campaign.mjs';
import { buildWiserrReactivationCommand, validateWiserrReactivationCommand } from '../src/reactivation/wiserr-command.mjs';

const NOW = new Date('2026-08-18T20:00:00.000Z');

function snapshot(overrides = {}) {
  const base = {
    schemaVersion: 1,
    snapshotId: 'snapshot-original',
    tenantId: 'tenant-1',
    generatedAt: NOW.toISOString(),
    completeness: 'COMPLETE_FOR_PURPOSE',
    capacity: { status: 'AVAILABLE', demandThrottleRecommended: false, reason: null },
    reactivation: {
      cohortDefinitionId: 'non-won-inactive-leads',
      cohortDefinitionVersion: '1:90d',
      dormantCount: 120,
      eligibleByChannel: { sms: 100, email: 80, whatsapp: 70 },
      suppressedCount: 20,
      latestRelevantActivityAt: '2026-05-01T00:00:00.000Z'
    },
    capabilities: {
      reactivationSms: true,
      reactivationEmail: false,
      reactivationWhatsapp: false,
      lunaReplyHandling: true,
      bookingOutcomes: true
    }
  };
  return {
    ...base,
    ...overrides,
    capacity: { ...base.capacity, ...(overrides.capacity || {}) },
    reactivation: {
      ...base.reactivation,
      ...(overrides.reactivation || {}),
      eligibleByChannel: {
        ...base.reactivation.eligibleByChannel,
        ...(overrides.reactivation?.eligibleByChannel || {})
      }
    },
    capabilities: { ...base.capabilities, ...(overrides.capabilities || {}) }
  };
}

function delegation() {
  return {
    schemaVersion: 1,
    assertionId: 'delegation-1',
    tenantId: 'tenant-1',
    grantingActorId: 'owner-1',
    issuerSystem: 'wiserr',
    issuerAuthorityRef: 'wiserr://authority/owner-1',
    status: 'ACTIVE',
    validFrom: '2026-08-18T19:00:00.000Z',
    validUntil: '2026-08-20T19:00:00.000Z',
    allowedDelegateSubjectIds: ['growth-strategist'],
    actionFamilies: ['REACTIVATION'],
    allowedAutonomyLevels: ['L3_APPROVAL_REQUIRED'],
    scopes: { channels: ['sms'], accountIds: ['wiserr-primary'], geographies: ['tampa-fl'] },
    limitCeilings: {
      maxSpendUsdPerDay: 100,
      maxSpendUsdTotal: 500,
      maxChangePercent: 25,
      maxAttempts: 1,
      maxRecipients: 200
    },
    canActivateEnvelopes: true,
    canRevokeEnvelopes: true,
    evidenceRef: 'wiserr://authority/owner-1',
    notes: ''
  };
}

function smsExecutionReady() {
  return {
    decision: 'READY',
    reasons: ['UPSTREAM_AUTHORITY_CERTIFIED'],
    metadata: {
      dependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID,
      lockFingerprint: 'c'.repeat(64)
    }
  };
}

function buildContext({ currentSnapshot = null } = {}) {
  const original = snapshot();
  const businessState = toGrowthBusinessState(original);
  const detected = evaluateDormantLeadReactivation(businessState, { minDormantLeads: 25, now: NOW });
  assert.equal(detected.decision, 'OPPORTUNITY');
  const opportunity = detected.opportunity;

  const plan = buildReactivationPlan({
    opportunity,
    snapshot: original,
    channel: 'sms',
    message: { strategy: 'helpful_reactivation', body: 'Approved private message', version: 'v1' },
    requestedMaxRecipients: 100,
    successMetric: 'BOOKING',
    observationHorizonHours: 72,
    maxAttempts: 1
  });

  let campaign = createReactivationCampaign(plan, { campaignId: 'campaign-1', now: NOW });
  campaign = submitReactivationCampaignForApproval(campaign, { now: NOW });
  campaign = approveReactivationCampaign(campaign, {
    approvalId: 'approval-1',
    approvedBy: 'owner-1',
    approvedPlanHash: plan.approvalHash,
    approvedAt: NOW,
    expiresAt: new Date('2026-08-19T20:00:00Z')
  });

  let experiment = createExperiment({
    experimentId: 'experiment-1',
    tenantId: 'tenant-1',
    opportunityId: opportunity.opportunityId,
    businessSnapshotId: original.snapshotId,
    hypothesis: 'Bounded reactivation can generate bookings.',
    actionPlanRef: plan.planId,
    actionPlanHash: plan.approvalHash,
    primaryMetric: 'booking_rate',
    successCriterion: { operator: 'GTE', threshold: 0.05 },
    guardrails: [{ metric: 'opt_out_rate', operator: 'GTE', threshold: 0.1 }],
    minimumSampleSize: 25,
    observationHorizonHours: 72,
    maxExposure: 100,
    maxSpendUsd: 50,
    createdAt: NOW
  });
  experiment = approveExperiment(experiment, {
    actorId: 'owner-1',
    approvalAuthorityRef: 'wiserr://authority/owner-1/experiment',
    now: NOW
  });

  const action = buildReactivationPolicyAction({
    plan,
    campaignApproval: campaign.approval,
    actionId: 'action-1',
    requestedBy: 'growth-strategist',
    experimentId: experiment.experimentId,
    accountId: 'wiserr-primary',
    geography: 'tampa-fl',
    expectedSpendUsd: 20,
    requestedAt: NOW
  });

  const draftEnvelope = createDraftEnvelope({
    envelopeId: 'envelope-1',
    tenantId: 'tenant-1',
    actionFamily: 'REACTIVATION',
    delegateSubjectId: 'growth-strategist',
    autonomyLevel: 'L3_APPROVAL_REQUIRED',
    validFrom: '2026-08-18T19:00:00.000Z',
    validUntil: '2026-08-19T19:00:00.000Z',
    channels: ['sms'],
    accountIds: ['wiserr-primary'],
    geographies: ['tampa-fl'],
    limits: {
      maxSpendUsdPerDay: 50,
      maxSpendUsdTotal: 100,
      maxChangePercent: 10,
      maxAttempts: 1,
      maxRecipients: 100
    },
    requiresApproval: true,
    approvalId: campaign.approval.approvalId,
    approvedActionHash: actionApprovalHash(action)
  });
  const envelope = activateEnvelope({ envelope: draftEnvelope, assertion: delegation(), actorId: 'owner-1', now: NOW });
  const decision = evaluateActionPolicy({ action, envelope, businessState, now: NOW });
  assert.equal(decision.decision, 'ALLOW');
  const policyReceipt = createPolicyDecisionReceipt({ action, envelope, decision, evaluatedAt: NOW });
  const attempt = createExecutionAttempt({ action, maxAttempts: 1, now: NOW });

  return {
    original,
    currentSnapshot: currentSnapshot || snapshot({ snapshotId: 'snapshot-current' }),
    opportunity,
    plan,
    campaign,
    experiment,
    action,
    envelope,
    policyReceipt,
    attempt,
    executionAuthorityDecision: smsExecutionReady()
  };
}

test('command uses current execution-time recipient ceiling and binds exact SMS execution authority', () => {
  const ctx = buildContext({
    currentSnapshot: snapshot({
      snapshotId: 'snapshot-current',
      reactivation: { eligibleByChannel: { sms: 37 } }
    })
  });
  const command = buildWiserrReactivationCommand({ ...ctx, now: NOW });
  assert.equal(command.maxRecipients, 37);
  assert.equal(ctx.plan.cohort.plannedMaxRecipients, 100);
  assert.equal(command.executionBusinessSnapshotId, 'snapshot-current');
  assert.equal(command.originalBusinessSnapshotId, 'snapshot-original');
  assert.equal(command.idempotencyKey, ctx.attempt.idempotencyKey);
  assert.equal(command.executionAuthorityDependencyId, WISERR_REACTIVATION_SMS_DEPENDENCY_ID);
  assert.equal(command.executionAuthorityLockFingerprint, ctx.executionAuthorityDecision.metadata.lockFingerprint);
  assert.equal(validateWiserrReactivationCommand(command), command);
});

test('READY snapshot-read authority cannot substitute for SMS execution authority', () => {
  const ctx = buildContext();
  const readAuthority = {
    decision: 'READY',
    reasons: ['UPSTREAM_AUTHORITY_CERTIFIED'],
    metadata: { dependencyId: 'wiserr-growth-snapshot-v1', lockFingerprint: 'd'.repeat(64) }
  };
  assert.throws(
    () => buildWiserrReactivationCommand({ ...ctx, executionAuthorityDecision: readAuthority, now: NOW }),
    /WISERR_REACTIVATION_SMS_EXECUTION_AUTHORITY_NOT_READY/
  );
});

test('current execution state can stop the handoff after approval', () => {
  const ctx = buildContext({
    currentSnapshot: snapshot({
      snapshotId: 'snapshot-current',
      capacity: { status: 'FULL', demandThrottleRecommended: true }
    })
  });
  assert.throws(
    () => buildWiserrReactivationCommand({ ...ctx, now: NOW }),
    /REACTIVATION_NOT_READY_FOR_WISERR:NO_ACTION:CURRENT_CAPACITY_FULL/
  );
});

test('non-ALLOW policy receipt cannot be used as execution authority', () => {
  const ctx = buildContext();
  const deniedReceipt = createPolicyDecisionReceipt({
    action: ctx.action,
    envelope: ctx.envelope,
    decision: { decision: 'DENY', reasons: ['TEST_DENIAL'], metadata: {} },
    evaluatedAt: NOW
  });
  assert.throws(
    () => buildWiserrReactivationCommand({ ...ctx, policyReceipt: deniedReceipt, now: NOW }),
    /REACTIVATION_POLICY_NOT_ALLOWED/
  );
});

test('attempt must still be pristine and bound to the exact approved action', () => {
  const ctx = buildContext();
  const submitting = structuredClone(ctx.attempt);
  markExecutionSubmitting(submitting, NOW);
  assert.throws(
    () => buildWiserrReactivationCommand({ ...ctx, attempt: submitting, now: NOW }),
    /REACTIVATION_ATTEMPT_NOT_CREATED/
  );

  const mismatched = { ...structuredClone(ctx.attempt), actionHash: 'f'.repeat(64) };
  assert.throws(
    () => buildWiserrReactivationCommand({ ...ctx, attempt: mismatched, now: NOW }),
    /REACTIVATION_ATTEMPT_ACTION_MISMATCH/
  );
});

test('post-approval message mutation cannot cross into the Wiserr command', () => {
  const ctx = buildContext();
  const mutatedCampaign = structuredClone(ctx.campaign);
  mutatedCampaign.plan.message.body = 'Changed after approval';
  assert.throws(
    () => buildWiserrReactivationCommand({ ...ctx, campaign: mutatedCampaign, now: NOW }),
    /REACTIVATION_CAMPAIGN_PLAN_INTEGRITY_FAILED/
  );
});

test('command hash detects authority or recipient mutation after handoff construction', () => {
  const ctx = buildContext();
  const command = buildWiserrReactivationCommand({ ...ctx, now: NOW });
  for (const changed of [
    { ...structuredClone(command), maxRecipients: command.maxRecipients - 1 },
    { ...structuredClone(command), executionAuthorityLockFingerprint: 'e'.repeat(64) }
  ]) {
    assert.throws(() => validateWiserrReactivationCommand(changed), /WISERR_REACTIVATION_COMMAND_HASH_MISMATCH/);
  }
});
