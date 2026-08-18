import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateActionPolicy } from '../src/core/control-plane.mjs';
import {
  assertPolicyReceiptMatches,
  createPolicyDecisionReceipt,
  envelopeAuthorityHash,
  policyReceiptToGrowthEvent,
  validatePolicyDecisionReceipt
} from '../src/core/policy-receipts.mjs';

const NOW = new Date('2026-08-18T20:10:00.000Z');

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    envelopeId: 'env-1',
    tenantId: 'tenant-1',
    actionFamily: 'REACTIVATION',
    autonomyLevel: 'L4_BOUNDED_AUTONOMOUS',
    status: 'ACTIVE',
    validFrom: '2026-08-18T19:00:00.000Z',
    validUntil: '2026-08-19T19:00:00.000Z',
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
    approvalHash: null,
    policyVersion: 'v1',
    notes: 'private operator note that must not enter the authority hash',
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
    requestedAt: '2026-08-18T20:09:00.000Z',
    requestedBy: 'growth-strategist',
    businessSnapshotId: 'snapshot-1',
    opportunityId: 'opp-1',
    experimentId: 'exp-1',
    inputs: {
      demandIncreasing: false,
      privateMessageBody: 'PRIVATE_CAMPAIGN_COPY_MUST_NOT_BE_LOGGED'
    },
    expectedCost: { spendUsd: 10, recipients: 100 },
    currentTotalSpendUsd: 50,
    currentDailySpendUsd: 5,
    changePercent: 10,
    attemptNumber: 1,
    approvalId: null,
    ...overrides
  };
}

function decisionFor(a = action(), e = envelope()) {
  return evaluateActionPolicy({ action: a, envelope: e, now: NOW });
}

test('creates a tamper-evident receipt for an exact policy decision', () => {
  const a = action();
  const e = envelope();
  const receipt = createPolicyDecisionReceipt({ action: a, envelope: e, decision: decisionFor(a, e), evaluatedAt: NOW });
  assert.equal(receipt.decision, 'ALLOW');
  assert.equal(validatePolicyDecisionReceipt(receipt), receipt);
  assert.equal(assertPolicyReceiptMatches({ receipt, action: a, envelope: e }), true);
});

test('receipt summary and growth event omit private action inputs and envelope notes', () => {
  const a = action();
  const e = envelope();
  const receipt = createPolicyDecisionReceipt({ action: a, envelope: e, decision: decisionFor(a, e), evaluatedAt: NOW });
  const serializedReceipt = JSON.stringify(receipt);
  assert.equal(serializedReceipt.includes('PRIVATE_CAMPAIGN_COPY_MUST_NOT_BE_LOGGED'), false);
  assert.equal(serializedReceipt.includes('private operator note'), false);

  const event = policyReceiptToGrowthEvent(receipt);
  const serializedEvent = JSON.stringify(event);
  assert.equal(serializedEvent.includes('PRIVATE_CAMPAIGN_COPY_MUST_NOT_BE_LOGGED'), false);
  assert.equal(event.eventType, 'growth.policy.decision');
  assert.equal(event.executionCertainty, 'NOT_APPLICABLE');
});

test('action mutation invalidates an existing policy receipt', () => {
  const a = action();
  const e = envelope();
  const receipt = createPolicyDecisionReceipt({ action: a, envelope: e, decision: decisionFor(a, e), evaluatedAt: NOW });
  const changed = action({ expectedCost: { spendUsd: 10, recipients: 101 } });
  assert.throws(() => assertPolicyReceiptMatches({ receipt, action: changed, envelope: e }), /POLICY_RECEIPT_ACTION_CHANGED/);
});

test('envelope authority mutation invalidates an existing policy receipt', () => {
  const a = action();
  const e = envelope();
  const receipt = createPolicyDecisionReceipt({ action: a, envelope: e, decision: decisionFor(a, e), evaluatedAt: NOW });
  const changed = envelope({ limits: { ...e.limits, maxRecipients: 250 } });
  assert.notEqual(envelopeAuthorityHash(e), envelopeAuthorityHash(changed));
  assert.throws(() => assertPolicyReceiptMatches({ receipt, action: a, envelope: changed }), /POLICY_RECEIPT_ENVELOPE_CHANGED/);
});

test('non-authority envelope notes do not invalidate receipt', () => {
  const a = action();
  const e = envelope();
  const receipt = createPolicyDecisionReceipt({ action: a, envelope: e, decision: decisionFor(a, e), evaluatedAt: NOW });
  const changedNotes = envelope({ notes: 'different non-authority operator note' });
  assert.equal(envelopeAuthorityHash(e), envelopeAuthorityHash(changedNotes));
  assert.equal(assertPolicyReceiptMatches({ receipt, action: a, envelope: changedNotes }), true);
});

test('tampering with receipt reasons is detected by receipt hash', () => {
  const a = action();
  const e = envelope();
  const receipt = createPolicyDecisionReceipt({ action: a, envelope: e, decision: decisionFor(a, e), evaluatedAt: NOW });
  const tampered = structuredClone(receipt);
  tampered.reasons = ['FAKE_REASON'];
  assert.throws(() => validatePolicyDecisionReceipt(tampered), /POLICY_RECEIPT_HASH_MISMATCH/);
});

test('DENY, REQUIRE_APPROVAL and NO_ACTION decisions can all produce auditable receipts', () => {
  const deniedAction = action({ channel: 'email' });
  const denied = createPolicyDecisionReceipt({ action: deniedAction, envelope: envelope(), decision: decisionFor(deniedAction, envelope()), evaluatedAt: NOW });
  assert.equal(denied.decision, 'DENY');

  const approvalAction = action({ inputs: { increasesTotalBudget: true } });
  const approval = createPolicyDecisionReceipt({ action: approvalAction, envelope: envelope(), decision: decisionFor(approvalAction, envelope()), evaluatedAt: NOW });
  assert.equal(approval.decision, 'REQUIRE_APPROVAL');

  const noActionInput = action({ inputs: { demandIncreasing: true } });
  const noActionDecision = evaluateActionPolicy({
    action: noActionInput,
    envelope: envelope(),
    businessState: {
      tenantId: 'tenant-1',
      completeness: 'COMPLETE_FOR_PURPOSE',
      capacity: { status: 'FULL', demandThrottleRecommended: true }
    },
    now: NOW
  });
  const noAction = createPolicyDecisionReceipt({ action: noActionInput, envelope: envelope(), decision: noActionDecision, evaluatedAt: NOW });
  assert.equal(noAction.decision, 'NO_ACTION');
});
