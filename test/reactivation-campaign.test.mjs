import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityExecutionProofHash } from '../src/core/capacity-execution-proof.mjs';
import { buildReactivationPlan } from '../src/reactivation/plan.mjs';
import {
  CAMPAIGN_START_DECISIONS,
  approveReactivationCampaign,
  assertCampaignPlanIntegrity,
  completeReactivationCampaign,
  createReactivationCampaign,
  evaluateReactivationCampaignStart,
  markReactivationCampaignObserving,
  markReactivationCampaignReconciliationRequired,
  startReactivationCampaign,
  stopReactivationCampaign,
  submitReactivationCampaignForApproval
} from '../src/reactivation/campaign.mjs';
import { UPSTREAM_AUTHORITY_DECISIONS } from '../src/core/upstream-authority.mjs';
import { WISERR_REACTIVATION_SMS_DEPENDENCY_ID } from '../src/integrations/wiserr/reactivation-sms-authority.mjs';

const NOW = new Date('2026-08-18T20:00:00.000Z');

function snapshot(overrides = {}) {
  const base = {
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    tenantId: 'tenant-1',
    generatedAt: '2026-08-18T19:59:00.000Z',
    completeness: 'PARTIAL',
    capacity: { status: 'UNKNOWN', demandThrottleRecommended: false },
    reactivation: {
      cohortDefinitionId: 'dormant-leads',
      cohortDefinitionVersion: 'v1',
      dormantCount: 100,
      suppressedCount: 20,
      eligibleByChannel: { sms: 80, email: 60, whatsapp: 0 }
    },
    capabilities: {
      reactivationSms: false,
      reactivationEmail: false,
      reactivationWhatsapp: false,
      lunaReplyHandling: false,
      bookingOutcomes: false
    }
  };
  return {
    ...base,
    ...overrides,
    capacity: { ...base.capacity, ...(overrides.capacity || {}) },
    reactivation: { ...base.reactivation, ...(overrides.reactivation || {}), eligibleByChannel: { ...base.reactivation.eligibleByChannel, ...(overrides.reactivation?.eligibleByChannel || {}) } },
    capabilities: { ...base.capabilities, ...(overrides.capabilities || {}) }
  };
}

function capacityProof(overrides = {}) {
  const body = {
    schemaVersion: 1,
    tenantId: 'tenant-1',
    capacityBundleId: 'capacity-bundle-1',
    capacitySemanticHash: 'a'.repeat(64),
    evidenceId: 'capacity-evidence-1',
    authorityId: 'capacity-authority-1',
    authorityHash: 'b'.repeat(64),
    sourceSystem: 'wiserr',
    sourceAuthority: 'wiserr://capacity/owner-attestation',
    scopeKey: 'tenant:tenant-1:service:all',
    asOf: '2026-08-18T19:55:00.000Z',
    validUntil: '2026-08-18T21:00:00.000Z',
    derivedStatus: 'AVAILABLE',
    demandThrottleRecommended: false,
    authorityDecision: 'READY',
    ...overrides
  };
  return { ...body, proofHash: capacityExecutionProofHash(body) };
}

function opportunity() {
  return { opportunityId: 'opp-1', tenantId: 'tenant-1', businessSnapshotId: 'snapshot-1', type: 'DORMANT_LEAD_REACTIVATION' };
}

function plan() {
  return buildReactivationPlan({ opportunity: opportunity(), snapshot: snapshot(), channel: 'sms', message: { strategy: 'direct-help', body: 'Hi, reply if you still need help.', version: 'v1' }, requestedMaxRecipients: 50 });
}

function approvedCampaign({ expiresAt = null } = {}) {
  const created = createReactivationCampaign(plan(), { now: NOW });
  const ready = submitReactivationCampaignForApproval(created, { now: NOW });
  return approveReactivationCampaign(ready, { approvalId: 'approval-1', approvedBy: 'owner-1', approvedPlanHash: ready.plan.approvalHash, approvedAt: NOW, expiresAt });
}

const executionReady = {
  decision: UPSTREAM_AUTHORITY_DECISIONS.READY,
  reasons: ['UPSTREAM_AUTHORITY_CERTIFIED'],
  metadata: { dependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID, lockFingerprint: 'c'.repeat(64) }
};

function startInput(campaign, overrides = {}) {
  return { campaign, currentSnapshot: snapshot(), capacityProof: capacityProof(), executionAuthorityDecision: executionReady, now: NOW, ...overrides };
}

test('campaign preserves exact approved plan and becomes execution-ready only after approval', () => {
  const campaign = approvedCampaign();
  assert.equal(campaign.status, 'APPROVED');
  assert.equal(assertCampaignPlanIntegrity(campaign), true);
  const result = evaluateReactivationCampaignStart(startInput(campaign));
  assert.equal(result.decision, CAMPAIGN_START_DECISIONS.READY);
  assert.equal(result.dispatchMaxRecipients, 50);
  assert.equal(result.capacityBundleId, 'capacity-bundle-1');
  assert.equal(result.executionAuthorityDependencyId, WISERR_REACTIVATION_SMS_DEPENDENCY_ID);
});

test('post-approval plan mutation requires reapproval', () => {
  const campaign = approvedCampaign();
  campaign.plan.message.body = 'Changed after approval';
  const result = evaluateReactivationCampaignStart(startInput(campaign));
  assert.equal(result.decision, CAMPAIGN_START_DECISIONS.REQUIRE_REAPPROVAL);
  assert.ok(result.reasons.includes('APPROVED_CAMPAIGN_PLAN_CHANGED'));
});

test('candidate or otherwise unready SMS execution authority denies execution', () => {
  const campaign = approvedCampaign();
  const result = evaluateReactivationCampaignStart(startInput(campaign, {
    executionAuthorityDecision: { decision: UPSTREAM_AUTHORITY_DECISIONS.REVIEW_REQUIRED, reasons: ['UPSTREAM_AUTHORITY_CANDIDATE'], metadata: { dependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID } }
  }));
  assert.equal(result.decision, CAMPAIGN_START_DECISIONS.DENY);
  assert.ok(result.reasons.includes('WISERR_REACTIVATION_SMS_EXECUTION_AUTHORITY_NOT_READY'));
});

test('READY decision from the snapshot-read dependency cannot authorize SMS execution', () => {
  const campaign = approvedCampaign();
  const result = evaluateReactivationCampaignStart(startInput(campaign, {
    executionAuthorityDecision: { decision: UPSTREAM_AUTHORITY_DECISIONS.READY, reasons: ['UPSTREAM_AUTHORITY_CERTIFIED'], metadata: { dependencyId: 'wiserr-growth-snapshot-v1', lockFingerprint: 'd'.repeat(64) } }
  }));
  assert.equal(result.decision, CAMPAIGN_START_DECISIONS.DENY);
  assert.ok(result.reasons.includes('WISERR_REACTIVATION_SMS_EXECUTION_AUTHORITY_NOT_READY'));
});

test('unavailable or expired external capacity produces NO_ACTION regardless of snapshot capacity', () => {
  const campaign = approvedCampaign();
  for (const proof of [
    capacityProof({ derivedStatus: 'FULL', demandThrottleRecommended: true }),
    capacityProof({ validUntil: '2026-08-18T19:59:00.000Z' })
  ]) {
    const result = evaluateReactivationCampaignStart(startInput(campaign, { currentSnapshot: snapshot({ capacity: { status: 'AVAILABLE', demandThrottleRecommended: false } }), capacityProof: proof }));
    assert.equal(result.decision, CAMPAIGN_START_DECISIONS.NO_ACTION);
  }
});

test('cohort definition drift requires reapproval rather than silently changing audience semantics', () => {
  const campaign = approvedCampaign();
  const result = evaluateReactivationCampaignStart(startInput(campaign, { currentSnapshot: snapshot({ reactivation: { cohortDefinitionVersion: 'v2' } }) }));
  assert.equal(result.decision, CAMPAIGN_START_DECISIONS.REQUIRE_REAPPROVAL);
  assert.ok(result.reasons.includes('COHORT_DEFINITION_CHANGED'));
});

test('snapshot capability flag is not send authority, while zero eligibility still chooses no action', () => {
  const campaign = approvedCampaign();
  const disabledFlag = evaluateReactivationCampaignStart(startInput(campaign, { currentSnapshot: snapshot({ capabilities: { reactivationSms: false } }) }));
  assert.equal(disabledFlag.decision, CAMPAIGN_START_DECISIONS.READY);

  const empty = evaluateReactivationCampaignStart(startInput(campaign, { currentSnapshot: snapshot({ reactivation: { eligibleByChannel: { sms: 0 } } }) }));
  assert.equal(empty.decision, CAMPAIGN_START_DECISIONS.NO_ACTION);
});

test('fewer currently eligible recipients lowers dispatch count without exceeding approved maximum', () => {
  const campaign = approvedCampaign();
  const result = evaluateReactivationCampaignStart(startInput(campaign, { currentSnapshot: snapshot({ reactivation: { eligibleByChannel: { sms: 25 } } }) }));
  assert.equal(result.decision, CAMPAIGN_START_DECISIONS.READY);
  assert.equal(result.dispatchMaxRecipients, 25);
});

test('expired campaign approval requires reapproval', () => {
  const campaign = approvedCampaign({ expiresAt: '2026-08-18T20:30:00.000Z' });
  const result = evaluateReactivationCampaignStart(startInput(campaign, { now: new Date('2026-08-18T21:00:00.000Z') }));
  assert.equal(result.decision, CAMPAIGN_START_DECISIONS.REQUIRE_REAPPROVAL);
  assert.ok(result.reasons.includes('CAMPAIGN_APPROVAL_EXPIRED'));
});

test('campaign lifecycle supports execute, observe, complete, reconciliation, and stop without illegal jumps', () => {
  const campaign = approvedCampaign();
  const executing = startReactivationCampaign(campaign, { attemptId: 'attempt-1', now: NOW });
  assert.equal(executing.status, 'EXECUTING');
  const observing = markReactivationCampaignObserving(executing, { now: NOW });
  const completed = completeReactivationCampaign(observing, { now: NOW });
  assert.equal(completed.status, 'COMPLETED');
  assert.throws(() => startReactivationCampaign(completed, { attemptId: 'attempt-2', now: NOW }));
  const second = startReactivationCampaign(approvedCampaign(), { attemptId: 'attempt-2', now: NOW });
  const uncertain = markReactivationCampaignReconciliationRequired(second, { reason: 'provider timeout after submission', now: NOW });
  const stopped = stopReactivationCampaign(uncertain, { reason: 'manual stop pending provider evidence', now: NOW });
  assert.equal(stopped.status, 'STOPPED');
});
