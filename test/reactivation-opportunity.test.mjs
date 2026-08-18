import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateDormantLeadReactivation, REACTIVATION_DECISIONS } from '../src/opportunities/reactivation.mjs';

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    snapshotId: 'snap-1',
    tenantId: 'tenant-1',
    sourceSystem: 'wiserr',
    asOf: '2026-08-18T18:00:00.000Z',
    completeness: 'COMPLETE_FOR_PURPOSE',
    business: { vertical: 'construction', timezone: 'America/New_York', locations: ['Tampa'], services: ['roofing'] },
    capacity: { status: 'AVAILABLE', signals: [], demandThrottleRecommended: false },
    funnel: {},
    cohorts: { dormantLeads: 100 },
    ...overrides
  };
}

test('detects a dormant-lead opportunity when evidence and capacity support action', () => {
  const result = evaluateDormantLeadReactivation(snapshot(), { now: new Date('2026-08-18T19:00:00Z') });
  assert.equal(result.decision, REACTIVATION_DECISIONS.OPPORTUNITY);
  assert.equal(result.opportunity.type, 'DORMANT_LEAD_REACTIVATION');
  assert.equal(result.opportunity.expectedImpact.low, 2);
  assert.equal(result.opportunity.expectedImpact.high, 8);
  assert.equal(result.opportunity.requiredAutonomyLevel, 'L3_APPROVAL_REQUIRED');
});

test('does not manufacture an opportunity from stale state', () => {
  const result = evaluateDormantLeadReactivation(snapshot({ completeness: 'STALE' }));
  assert.equal(result.decision, REACTIVATION_DECISIONS.INSUFFICIENT_EVIDENCE);
  assert.ok(result.reasons.includes('BUSINESS_STATE_NOT_FRESH_ENOUGH'));
});

test('chooses NO_ACTION when capacity is full or demand throttle is recommended', () => {
  const full = evaluateDormantLeadReactivation(snapshot({ capacity: { status: 'FULL', demandThrottleRecommended: false } }));
  assert.equal(full.decision, REACTIVATION_DECISIONS.NO_ACTION);

  const throttled = evaluateDormantLeadReactivation(snapshot({ capacity: { status: 'AVAILABLE', demandThrottleRecommended: true } }));
  assert.equal(throttled.decision, REACTIVATION_DECISIONS.NO_ACTION);
});

test('does not recommend execution for tiny cohorts below configured threshold', () => {
  const result = evaluateDormantLeadReactivation(snapshot({ cohorts: { dormantLeads: 10 } }), { minDormantLeads: 25 });
  assert.equal(result.decision, REACTIVATION_DECISIONS.NO_ACTION);
  assert.ok(result.reasons.includes('COHORT_BELOW_MINIMUM_ACTION_THRESHOLD'));
});

test('marks opportunity constrained rather than pretending capacity is unlimited', () => {
  const result = evaluateDormantLeadReactivation(snapshot({ capacity: { status: 'CONSTRAINED', demandThrottleRecommended: false } }));
  assert.equal(result.decision, REACTIVATION_DECISIONS.OPPORTUNITY);
  assert.equal(result.opportunity.operationalFeasibility, 'CONSTRAINED');
});
