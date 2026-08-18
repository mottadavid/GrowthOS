import test from 'node:test';
import assert from 'node:assert/strict';
import { actionApprovalHash } from '../src/core/canonical.mjs';
import { CONTROL_DECISIONS, evaluateActionPolicy } from '../src/core/control-plane.mjs';

const NOW = new Date('2026-08-18T19:00:00.000Z');

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    envelopeId: 'env-1',
    tenantId: 'tenant-1',
    actionFamily: 'REACTIVATION',
    autonomyLevel: 'L4_BOUNDED_AUTONOMOUS',
    status: 'ACTIVE',
    validFrom: '2026-08-18T00:00:00.000Z',
    validUntil: '2026-08-19T00:00:00.000Z',
    channels: ['sms'],
    accountIds: ['wiserr-primary'],
    geographies: ['tampa-fl'],
    limits: {
      maxSpendUsdPerDay: 50,
      maxSpendUsdTotal: 200,
      maxChangePercent: 20,
      maxAttempts: 1,
      maxRecipients: 500
    },
    requiresApproval: false,
    approvalId: null,
    approvedActionHash: null,
    policyVersion: 'v1',
    notes: '',
    ...overrides
  };
}

function action(overrides = {}) {
  return {
    schemaVersion: 1,
    actionId: 'action-1',
    tenantId: 'tenant-1',
    actionFamily: 'REACTIVATION',
    actionType: 'SEND_REACTIVATION_SEQUENCE',
    channel: 'sms',
    accountId: 'wiserr-primary',
    geography: 'tampa-fl',
    requestedAt: '2026-08-18T18:59:00.000Z',
    requestedBy: 'growth-strategist',
    businessSnapshotId: 'snapshot-1',
    opportunityId: 'opp-1',
    experimentId: 'exp-1',
    inputs: { demandIncreasing: false },
    expectedCost: { spendUsd: 10, recipients: 100 },
    currentTotalSpendUsd: 50,
    currentDailySpendUsd: 5,
    changePercent: 10,
    attemptNumber: 1,
    approvalId: null,
    ...overrides
  };
}

function businessState(overrides = {}) {
  return {
    tenantId: 'tenant-1',
    completeness: 'COMPLETE_FOR_PURPOSE',
    capacity: {
      status: 'AVAILABLE',
      demandThrottleRecommended: false
    },
    ...overrides
  };
}

test('allows an L4 action entirely inside its active envelope', () => {
  const result = evaluateActionPolicy({ action: action(), envelope: envelope(), businessState: businessState(), now: NOW });
  assert.equal(result.decision, CONTROL_DECISIONS.ALLOW);
});

test('denies cross-tenant execution', () => {
  const result = evaluateActionPolicy({ action: action({ tenantId: 'tenant-2' }), envelope: envelope(), businessState: null, now: NOW });
  assert.equal(result.decision, CONTROL_DECISIONS.DENY);
  assert.ok(result.reasons.includes('TENANT_MISMATCH'));
});

test('denies unauthorized channel/account/geography', () => {
  const result = evaluateActionPolicy({
    action: action({ channel: 'email', accountId: 'other-account', geography: 'orlando-fl' }),
    envelope: envelope(),
    now: NOW
  });
  assert.equal(result.decision, CONTROL_DECISIONS.DENY);
  assert.ok(result.reasons.includes('CHANNEL_NOT_AUTHORIZED'));
  assert.ok(result.reasons.includes('ACCOUNT_NOT_AUTHORIZED'));
  assert.ok(result.reasons.includes('GEOGRAPHY_NOT_AUTHORIZED'));
});

test('denies unknown or excessive spend when envelope has spend ceilings', () => {
  const unknown = evaluateActionPolicy({ action: action({ expectedCost: { spendUsd: null, recipients: 100 } }), envelope: envelope(), now: NOW });
  assert.equal(unknown.decision, CONTROL_DECISIONS.DENY);
  assert.ok(unknown.reasons.includes('SPEND_UNKNOWN'));

  const excessive = evaluateActionPolicy({
    action: action({ expectedCost: { spendUsd: 160, recipients: 100 }, currentTotalSpendUsd: 50 }),
    envelope: envelope(),
    now: NOW
  });
  assert.equal(excessive.decision, CONTROL_DECISIONS.DENY);
  assert.ok(excessive.reasons.includes('TOTAL_SPEND_LIMIT_EXCEEDED'));
});

test('denies recipient and attempt ceiling breaches', () => {
  const result = evaluateActionPolicy({
    action: action({ expectedCost: { spendUsd: 10, recipients: 600 }, attemptNumber: 2 }),
    envelope: envelope(),
    now: NOW
  });
  assert.equal(result.decision, CONTROL_DECISIONS.DENY);
  assert.ok(result.reasons.includes('RECIPIENT_LIMIT_EXCEEDED'));
  assert.ok(result.reasons.includes('ATTEMPT_LIMIT_EXCEEDED'));
});

test('L3 action requires exact approval and then allows it', () => {
  const candidate = action({ approvalId: 'approval-1' });
  const env = envelope({
    autonomyLevel: 'L3_APPROVAL_REQUIRED',
    requiresApproval: true,
    approvalId: 'approval-1',
    approvedActionHash: actionApprovalHash(candidate)
  });

  const pending = evaluateActionPolicy({ action: action(), envelope: env, now: NOW });
  assert.equal(pending.decision, CONTROL_DECISIONS.REQUIRE_APPROVAL);

  const approved = evaluateActionPolicy({ action: candidate, envelope: env, now: NOW });
  assert.equal(approved.decision, CONTROL_DECISIONS.ALLOW);
});

test('approval is invalidated when an approval-bound action changes', () => {
  const approvedAction = action({ approvalId: 'approval-1' });
  const env = envelope({
    autonomyLevel: 'L3_APPROVAL_REQUIRED',
    requiresApproval: true,
    approvalId: 'approval-1',
    approvedActionHash: actionApprovalHash(approvedAction)
  });

  const mutated = action({
    approvalId: 'approval-1',
    expectedCost: { spendUsd: 15, recipients: 100 }
  });
  const result = evaluateActionPolicy({ action: mutated, envelope: env, now: NOW });
  assert.equal(result.decision, CONTROL_DECISIONS.REQUIRE_APPROVAL);
  assert.ok(result.reasons.includes('APPROVED_ACTION_CHANGED'));
});

test('non-executable L0-L2 envelopes never execute', () => {
  for (const autonomyLevel of ['L0_OBSERVE', 'L1_RECOMMEND', 'L2_DRAFT']) {
    const result = evaluateActionPolicy({ action: action(), envelope: envelope({ autonomyLevel }), now: NOW });
    assert.equal(result.decision, CONTROL_DECISIONS.DENY);
    assert.ok(result.reasons.includes('AUTONOMY_LEVEL_NOT_EXECUTABLE'));
  }
});

test('demand-increasing action becomes NO_ACTION when business capacity is constrained', () => {
  const result = evaluateActionPolicy({
    action: action({ inputs: { demandIncreasing: true } }),
    envelope: envelope(),
    businessState: businessState({ capacity: { status: 'CONSTRAINED', demandThrottleRecommended: true } }),
    now: NOW
  });
  assert.equal(result.decision, CONTROL_DECISIONS.NO_ACTION);
  assert.ok(result.reasons.includes('BUSINESS_CAPACITY_CONSTRAINED'));
});

test('demand-increasing action becomes NO_ACTION when business state is stale', () => {
  const result = evaluateActionPolicy({
    action: action({ inputs: { demandIncreasing: true } }),
    envelope: envelope(),
    businessState: businessState({ completeness: 'STALE' }),
    now: NOW
  });
  assert.equal(result.decision, CONTROL_DECISIONS.NO_ACTION);
  assert.ok(result.reasons.includes('BUSINESS_STATE_NOT_FRESH_ENOUGH_FOR_DEMAND_INCREASE'));
});

test('autonomous budget expansion and consequential offer changes escalate to approval', () => {
  const result = evaluateActionPolicy({
    action: action({ inputs: { increasesTotalBudget: true, changesPublicPrice: true, materialDiscount: true } }),
    envelope: envelope(),
    now: NOW
  });
  assert.equal(result.decision, CONTROL_DECISIONS.REQUIRE_APPROVAL);
  assert.ok(result.reasons.includes('TOTAL_BUDGET_EXPANSION_REQUIRES_APPROVAL'));
  assert.ok(result.reasons.includes('PUBLIC_PRICE_CHANGE_REQUIRES_APPROVAL'));
  assert.ok(result.reasons.includes('MATERIAL_DISCOUNT_REQUIRES_APPROVAL'));
});

test('revoked and expired envelopes deny execution', () => {
  const revoked = evaluateActionPolicy({ action: action(), envelope: envelope({ status: 'REVOKED' }), now: NOW });
  assert.equal(revoked.decision, CONTROL_DECISIONS.DENY);
  assert.ok(revoked.reasons.includes('ENVELOPE_REVOKED'));

  const expired = evaluateActionPolicy({
    action: action(),
    envelope: envelope({ validUntil: '2026-08-18T18:00:00.000Z' }),
    now: NOW
  });
  assert.equal(expired.decision, CONTROL_DECISIONS.DENY);
  assert.ok(expired.reasons.includes('ENVELOPE_EXPIRED'));
});
