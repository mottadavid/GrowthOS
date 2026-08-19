import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDormantLeadReactivation } from '../src/opportunities/reactivation.mjs';
import { chooseReactivationChannel, channelEligibility, toGrowthBusinessState } from '../src/integrations/wiserr/growth-snapshot.mjs';
import {
  assertApprovedReactivationPlan,
  buildReactivationPlan,
  buildWiserrReactivationExecutionRequest,
  reactivationPlanApprovalHash
} from '../src/reactivation/plan.mjs';

function snapshot(overrides = {}) {
  const base = {
    schemaVersion: 1,
    snapshotId: 'snap-1',
    tenantId: 'tenant-1',
    generatedAt: '2026-08-18T19:00:00.000Z',
    completeness: 'COMPLETE_FOR_PURPOSE',
    capacity: { status: 'AVAILABLE', demandThrottleRecommended: false, reason: null },
    reactivation: {
      cohortDefinitionId: 'dormant-leads-90d',
      cohortDefinitionVersion: '1',
      dormantCount: 120,
      eligibleByChannel: { sms: 80, email: 100, whatsapp: 60 },
      suppressedCount: 20,
      latestRelevantActivityAt: '2026-08-01T12:00:00.000Z'
    },
    capabilities: {
      reactivationSms: true,
      reactivationEmail: true,
      reactivationWhatsapp: false,
      lunaReplyHandling: true,
      bookingOutcomes: true
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

function opportunityFrom(snap = snapshot()) {
  const state = toGrowthBusinessState(snap);
  const result = evaluateDormantLeadReactivation(state, { now: new Date('2026-08-18T19:05:00.000Z') });
  assert.equal(result.decision, 'OPPORTUNITY');
  return result.opportunity;
}

test('adapts bounded Wiserr snapshot into GrowthOS business state', () => {
  const state = toGrowthBusinessState(snapshot());
  assert.equal(state.tenantId, 'tenant-1');
  assert.equal(state.cohorts.dormantLeads, 120);
  assert.equal(state.capacity.status, 'AVAILABLE');
});

test('legacy capability-aware channel chooser still requires capability plus eligibility', () => {
  const result = chooseReactivationChannel(snapshot(), ['whatsapp', 'sms', 'email']);
  assert.equal(result.selected.channel, 'sms');
  assert.equal(result.evaluated[0].ready, false);
});

test('planning can use channel eligibility even when snapshot does not certify send capability', () => {
  const snap = snapshot({ capabilities: { reactivationSms: false } });
  const eligibility = channelEligibility(snap, 'sms');
  assert.equal(eligibility.eligibleRecipients, 80);
  assert.equal(snap.capabilities.reactivationSms, false);
  const opportunity = opportunityFrom(snap);
  const plan = buildReactivationPlan({
    opportunity,
    snapshot: snap,
    channel: 'sms',
    requestedMaxRecipients: 50,
    message: { strategy: 'simple-return', body: 'Still interested? Reply here.', version: '1' }
  });
  assert.equal(plan.channel, 'sms');
  assert.equal(plan.cohort.plannedMaxRecipients, 50);
  assert.equal(plan.execution.requiresCapability, 'reactivationSms');
});

test('planning still fails closed when the requested channel has zero eligible recipients', () => {
  const snap = snapshot({ capabilities: { reactivationSms: false }, reactivation: { eligibleByChannel: { sms: 0 } } });
  const opportunity = opportunityFrom(snap);
  assert.throws(() => buildReactivationPlan({
    opportunity,
    snapshot: snap,
    channel: 'sms',
    requestedMaxRecipients: 50,
    message: { strategy: 'simple-return', body: 'Still interested? Reply here.', version: '1' }
  }), /No currently eligible sms recipients/);
});

test('builds a plan capped by current eligible cohort', () => {
  const snap = snapshot({ reactivation: { eligibleByChannel: { sms: 42 } } });
  const opportunity = opportunityFrom(snap);
  const plan = buildReactivationPlan({ opportunity, snapshot: snap, channel: 'sms', requestedMaxRecipients: 100, message: { strategy: 'simple-return', body: 'Still interested? Reply here.', version: '1' } });
  assert.equal(plan.cohort.plannedMaxRecipients, 42);
  assert.match(plan.approvalHash, /^[0-9a-f]{64}$/);
});

test('plan approval is invalidated by message, cohort, or channel mutation', () => {
  const snap = snapshot();
  const opportunity = opportunityFrom(snap);
  const plan = buildReactivationPlan({ opportunity, snapshot: snap, channel: 'sms', requestedMaxRecipients: 50, message: { strategy: 'simple-return', body: 'Still interested? Reply here.', version: '1' } });
  const approvedHash = plan.approvalHash;
  assert.equal(assertApprovedReactivationPlan(plan, approvedHash), true);
  const mutated = structuredClone(plan);
  mutated.message.body = 'Different unapproved message';
  assert.throws(() => assertApprovedReactivationPlan(mutated, approvedHash), /APPROVED_REACTIVATION_PLAN_CHANGED/);
  assert.notEqual(reactivationPlanApprovalHash(mutated), approvedHash);
});

test('execution request preserves exact approval, cohort version, and stable idempotency key', () => {
  const snap = snapshot();
  const opportunity = opportunityFrom(snap);
  const plan = buildReactivationPlan({ opportunity, snapshot: snap, channel: 'email', requestedMaxRecipients: 75, successMetric: 'WON_CUSTOMER', message: { strategy: 'return-offer', body: 'We have an opening this week. Reply if useful.', version: '2', offerId: 'offer-7' } });
  const request = buildWiserrReactivationExecutionRequest({ plan, approvalHash: plan.approvalHash, actionId: 'action-123', experimentId: 'experiment-9' });
  assert.equal(request.planApprovalHash, plan.approvalHash);
  assert.equal(request.cohortDefinitionId, 'dormant-leads-90d');
  assert.equal(request.cohortDefinitionVersion, '1');
  assert.equal(request.maxRecipients, 75);
  assert.equal(request.idempotencyKey, 'growthos:tenant-1:action-123:attempt:1');
});

test('snapshot mismatch blocks planning from stale opportunity evidence', () => {
  const old = snapshot();
  const opportunity = opportunityFrom(old);
  const newer = snapshot({ snapshotId: 'snap-2' });
  assert.throws(() => buildReactivationPlan({ opportunity, snapshot: newer, channel: 'sms', requestedMaxRecipients: 50, message: { strategy: 'simple-return', body: 'Still interested? Reply here.', version: '1' } }), /Opportunity snapshot does not match current Wiserr snapshot/);
});
