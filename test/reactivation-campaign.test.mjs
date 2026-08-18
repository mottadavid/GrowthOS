import test from 'node:test';
import assert from 'node:assert/strict';
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

const NOW = new Date('2026-08-18T20:00:00.000Z');

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    tenantId: 'tenant-1',
    generatedAt: '2026-08-18T19:59:00.000Z',
    completeness: 'COMPLETE_FOR_PURPOSE',
    capacity: { status: 'AVAILABLE', demandThrottleRecommended: false },
    reactivation: {
      cohortDefinitionId: 'dormant-leads',
      cohortDefinitionVersion: 'v1',
      dormantCount: 100,
      suppressedCount: 20,
      eligibleByChannel: { sms: 80, email: 60, whatsapp: 0 }
    },
    capabilities: {
      reactivationSms: true,
      reactivationEmail: true,
      reactivationWhatsapp: false,
      lunaReplyHandling: false,
      bookingOutcomes: false
    },
    ...overrides
  };
}

function opportunity() {
  return {
    opportunityId: 'opp-1',
    tenantId: 'tenant-1',
    businessSnapshotId: 'snapshot-1',
    type: 'DORMANT_LEAD_REACTIVATION'
  };
}

function plan() {
  return buildReactivationPlan({
    opportunity: opportunity(),
    snapshot: snapshot(),
    channel: 'sms',
    message: { strategy: 'direct-help', body: 'Hi, reply if you still need help.', version: 'v1' },
    requestedMaxRecipients: 50
  });
}

function approvedCampaign({ expiresAt = null } = {}) {
  const created = createReactivationCampaign(plan(), { now: NOW });
  const ready = submitReactivationCampaignForApproval(created, { now: NOW });
  return approveReactivationCampaign(ready, {
    approvalId: 'approval-1',
    approvedBy: 'owner-1',
    approvedPlanHash: ready.plan.approvalHash,
    approvedAt: NOW,
    expiresAt
  });
}

const upstreamReady = {
  decision: UPSTREAM_AUTHORITY_DECISIONS.READY,
  reasons: ['UPSTREAM_AUTHORITY_CERTIFIED']
};

test('campaign preserves exact approved plan and becomes execution-ready only after approval', () => {
  const campaign = approvedCampaign();
  assert.equal(campaign.status, 'APPROVED');
  assert.equal(assertCampaignPlanIntegrity(campaign), true);
  const result = evaluateReactivationCampaignStart({ campaign, currentSnapshot: snapshot(), upstreamDecision: upstreamReady, now: NOW });
  assert.equal(result.decision, CAMPAIGN_START_DECISIONS.READY);
  assert.equal(result.dispatchMaxRecipients, 50);
});

test('post-approval plan mutation requires reapproval', () => {
  const campaign = approvedCampaign();
  campaign.plan.message.body = 'Changed after approval';
  const result = evaluateReactivationCampaignStart({ campaign, currentSnapshot: snapshot(), upstreamDecision: upstreamReady, now: NOW });
  assert.equal(result.decision, CAMPAIGN_START_DECISIONS.REQUIRE_REAPPROVAL);
  assert.ok(result.reasons.includes('APPROVED_CAMPAIGN_PLAN_CHANGED'));
});

test('candidate or otherwise unready upstream authority denies execution', () => {
  const campaign = approvedCampaign();
  const result = evaluateReactivationCampaignStart({
    campaign,
    currentSnapshot: snapshot(),
    upstreamDecision: { decision: UPSTREAM_AUTHORITY_DECISIONS.REVIEW_REQUIRED, reasons: ['UPSTREAM_AUTHORITY_CANDIDATE'] },
    now: NOW
  });
  assert.equal(result.decision, CAMPAIGN_START_DECISIONS.DENY);
  assert.ok(result.reasons.includes('UPSTREAM_AUTHORITY_NOT_READY'));
});

test('execution-time capacity change produces NO_ACTION', () => {
  const campaign = approvedCampaign();
  for (const status of ['UNKNOWN', 'CONSTRAINED', 'FULL']) {
    const result = evaluateReactivationCampaignStart({
      campaign,
      currentSnapshot: snapshot({ capacity: { status, demandThrottleRecommended: true } }),
      upstreamDecision: upstreamReady,
      now: NOW
    });
    assert.equal(result.decision, CAMPAIGN_START_DECISIONS.NO_ACTION);
  }
});

test('cohort definition drift requires reapproval rather than silently changing audience semantics', () => {
  const campaign = approvedCampaign();
  const result = evaluateReactivationCampaignStart({
    campaign,
    currentSnapshot: snapshot({
      reactivation: {
        cohortDefinitionId: 'dormant-leads',
        cohortDefinitionVersion: 'v2',
        dormantCount: 100,
        suppressedCount: 20,
        eligibleByChannel: { sms: 80, email: 60, whatsapp: 0 }
      }
    }),
    upstreamDecision: upstreamReady,
    now: NOW
  });
  assert.equal(result.decision, CAMPAIGN_START_DECISIONS.REQUIRE_REAPPROVAL);
  assert.ok(result.reasons.includes('COHORT_DEFINITION_CHANGED'));
});

test('current capability revocation denies and zero eligible recipients chooses no action', () => {
  const campaign = approvedCampaign();
  const disabled = evaluateReactivationCampaignStart({
    campaign,
    currentSnapshot: snapshot({
      capabilities: { reactivationSms: false, reactivationEmail: true, reactivationWhatsapp: false, lunaReplyHandling: false, bookingOutcomes: false }
    }),
    upstreamDecision: upstreamReady,
    now: NOW
  });
  assert.equal(disabled.decision, CAMPAIGN_START_DECISIONS.DENY);

  const empty = evaluateReactivationCampaignStart({
    campaign,
    currentSnapshot: snapshot({
      reactivation: {
        cohortDefinitionId: 'dormant-leads',
        cohortDefinitionVersion: 'v1',
        dormantCount: 100,
        suppressedCount: 100,
        eligibleByChannel: { sms: 0, email: 0, whatsapp: 0 }
      }
    }),
    upstreamDecision: upstreamReady,
    now: NOW
  });
  assert.equal(empty.decision, CAMPAIGN_START_DECISIONS.NO_ACTION);
});

test('fewer currently eligible recipients lowers dispatch count without exceeding approved maximum', () => {
  const campaign = approvedCampaign();
  const result = evaluateReactivationCampaignStart({
    campaign,
    currentSnapshot: snapshot({
      reactivation: {
        cohortDefinitionId: 'dormant-leads',
        cohortDefinitionVersion: 'v1',
        dormantCount: 100,
        suppressedCount: 75,
        eligibleByChannel: { sms: 25, email: 20, whatsapp: 0 }
      }
    }),
    upstreamDecision: upstreamReady,
    now: NOW
  });
  assert.equal(result.decision, CAMPAIGN_START_DECISIONS.READY);
  assert.equal(result.dispatchMaxRecipients, 25);
});

test('expired campaign approval requires reapproval', () => {
  const campaign = approvedCampaign({ expiresAt: '2026-08-18T20:30:00.000Z' });
  const result = evaluateReactivationCampaignStart({
    campaign,
    currentSnapshot: snapshot(),
    upstreamDecision: upstreamReady,
    now: new Date('2026-08-18T21:00:00.000Z')
  });
  assert.equal(result.decision, CAMPAIGN_START_DECISIONS.REQUIRE_REAPPROVAL);
  assert.ok(result.reasons.includes('CAMPAIGN_APPROVAL_EXPIRED'));
});

test('campaign lifecycle supports execute, observe, complete, reconciliation, and stop without illegal jumps', () => {
  const campaign = approvedCampaign();
  const executing = startReactivationCampaign(campaign, { attemptId: 'attempt-1', now: NOW });
  assert.equal(executing.status, 'EXECUTING');

  const observing = markReactivationCampaignObserving(executing, { now: NOW });
  assert.equal(observing.status, 'OBSERVING');
  const completed = completeReactivationCampaign(observing, { now: NOW });
  assert.equal(completed.status, 'COMPLETED');
  assert.throws(() => startReactivationCampaign(completed, { attemptId: 'attempt-2', now: NOW }));

  const second = startReactivationCampaign(approvedCampaign(), { attemptId: 'attempt-2', now: NOW });
  const uncertain = markReactivationCampaignReconciliationRequired(second, { reason: 'provider timeout after submission', now: NOW });
  assert.equal(uncertain.status, 'RECONCILIATION_REQUIRED');
  const stopped = stopReactivationCampaign(uncertain, { reason: 'manual stop pending provider evidence', now: NOW });
  assert.equal(stopped.status, 'STOPPED');
});
