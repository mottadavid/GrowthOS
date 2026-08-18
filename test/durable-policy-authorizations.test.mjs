import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import {
  evaluateAndPersistPolicyAuthorization,
  loadDurablePolicyAuthorization,
  listDurablePolicyAuthorizations,
  assertDurablePolicyAuthorizationMatches
} from '../src/runtime/policy-authorization-repository.mjs';

const NOW = new Date('2026-08-18T21:00:00.000Z');

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
    requestedAt: NOW.toISOString(),
    requestedBy: 'growth-worker',
    businessSnapshotId: 'snapshot-1',
    opportunityId: 'opp-1',
    experimentId: 'exp-1',
    inputs: {
      demandIncreasing: true,
      planId: 'plan-1',
      privateOperatorContext: 'DO NOT PUT THIS IN POLICY EVENTS',
      increasesTotalBudget: false,
      changesPublicPrice: false,
      createsGuarantee: false,
      materialDiscount: false
    },
    expectedCost: { spendUsd: 10, recipients: 50 },
    currentTotalSpendUsd: 0,
    currentDailySpendUsd: 0,
    changePercent: 0,
    attemptNumber: 1,
    approvalId: null,
    ...overrides
  };
}

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    envelopeId: 'env-1',
    tenantId: 'tenant-1',
    actionFamily: 'REACTIVATION',
    delegateSubjectId: 'growth-worker',
    autonomyLevel: 'L4_BOUNDED_AUTONOMOUS',
    status: 'ACTIVE',
    validFrom: '2026-08-18T20:00:00.000Z',
    validUntil: '2026-08-19T20:00:00.000Z',
    channels: ['sms'],
    accountIds: ['wiserr-primary'],
    geographies: ['tampa-fl'],
    limits: {
      maxAttempts: 1,
      maxSpendUsdPerDay: 100,
      maxSpendUsdTotal: 500,
      maxChangePercent: 10,
      maxRecipients: 100
    },
    requiresApproval: false,
    approvalId: null,
    approvedActionHash: null,
    policyVersion: 'v1',
    authorityAssertionId: 'assertion-1',
    authorityAssertionHash: 'a'.repeat(64),
    activatedAt: '2026-08-18T20:00:00.000Z',
    activatedBy: 'owner-1',
    replacesEnvelopeId: null,
    ...overrides
  };
}

function businessState(overrides = {}) {
  return {
    tenantId: 'tenant-1',
    completeness: 'COMPLETE_FOR_PURPOSE',
    capacity: { status: 'AVAILABLE', demandThrottleRecommended: false },
    ...overrides
  };
}

test('real policy evaluation persists the exact action and ALLOW receipt durably', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const result = await evaluateAndPersistPolicyAuthorization({
    store,
    action: action(),
    envelope: envelope(),
    businessState: businessState(),
    now: NOW,
    receiptId: 'receipt-1'
  });
  assert.equal(result.decision.decision, 'ALLOW');
  assert.equal(result.record.payload.receipt.decision, 'ALLOW');
  assert.equal(result.record.indexKey, 'action-1');
  assert.equal(result.record.payload.action.inputs.planId, 'plan-1');

  const recovered = await loadDurablePolicyAuthorization({ store, tenantId: 'tenant-1', receiptId: 'receipt-1' });
  assert.equal(recovered.payload.receipt.receiptId, 'receipt-1');
  assert.equal(assertDurablePolicyAuthorizationMatches({ record: recovered, action: action(), envelope: envelope() }), true);
});

test('action mutation after policy evaluation cannot reuse the durable authorization', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const result = await evaluateAndPersistPolicyAuthorization({
    store, action: action(), envelope: envelope(), businessState: businessState(), now: NOW, receiptId: 'receipt-1'
  });
  const changed = action({ expectedCost: { spendUsd: 10, recipients: 80 } });
  assert.throws(
    () => assertDurablePolicyAuthorizationMatches({ record: result.record, action: changed, envelope: envelope() }),
    /POLICY_RECEIPT_ACTION_CHANGED|DURABLE_POLICY_AUTHORIZATION_ACTION_CHANGED/
  );
});

test('DENY decisions are retained as evidence and cannot be confused with ALLOW', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const result = await evaluateAndPersistPolicyAuthorization({
    store,
    action: action({ channel: 'email' }),
    envelope: envelope(),
    businessState: businessState(),
    now: NOW,
    receiptId: 'receipt-deny'
  });
  assert.equal(result.decision.decision, 'DENY');
  assert.equal(result.record.payload.receipt.decision, 'DENY');
  assert.ok(result.record.payload.receipt.reasons.includes('CHANNEL_NOT_AUTHORIZED'));
});

test('business-state proof is hashed and summarized without copying arbitrary fields into evidence event', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const state = businessState({ internalDiagnostic: 'PRIVATE CAPACITY DIAGNOSTIC' });
  const result = await evaluateAndPersistPolicyAuthorization({
    store, action: action(), envelope: envelope(), businessState: state, now: NOW, receiptId: 'receipt-1'
  });
  assert.match(result.record.payload.businessStateHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(result.record.payload.businessStateSummary, {
    tenantId: 'tenant-1',
    completeness: 'COMPLETE_FOR_PURPOSE',
    capacity: { status: 'AVAILABLE', demandThrottleRecommended: false }
  });

  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: 'action-1' });
  assert.equal(events.length, 1);
  const serialized = JSON.stringify(events[0]);
  assert.equal(serialized.includes('PRIVATE CAPACITY DIAGNOSTIC'), false);
  assert.equal(serialized.includes('DO NOT PUT THIS IN POLICY EVENTS'), false);
});

test('same receipt ID is idempotent only for the exact same policy bundle', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const first = await evaluateAndPersistPolicyAuthorization({
    store, action: action(), envelope: envelope(), businessState: businessState(), now: NOW, receiptId: 'receipt-1'
  });
  const second = await evaluateAndPersistPolicyAuthorization({
    store, action: action(), envelope: envelope(), businessState: businessState(), now: NOW, receiptId: 'receipt-1'
  });
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);

  await assert.rejects(
    () => evaluateAndPersistPolicyAuthorization({
      store,
      action: action({ actionId: 'action-2' }),
      envelope: envelope(),
      businessState: businessState(),
      now: NOW,
      receiptId: 'receipt-1'
    }),
    /DURABLE_POLICY_AUTHORIZATION_RECEIPT_ID_CONFLICT|DURABLE_POLICY_AUTHORIZATION_IDENTITY_MISMATCH/
  );
});

test('action-scoped recovery lists only authorizations for the exact action', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await evaluateAndPersistPolicyAuthorization({ store, action: action(), envelope: envelope(), businessState: businessState(), now: NOW, receiptId: 'r1' });
  await evaluateAndPersistPolicyAuthorization({ store, action: action({ actionId: 'action-2' }), envelope: envelope(), businessState: businessState(), now: NOW, receiptId: 'r2' });
  const records = await listDurablePolicyAuthorizations({ store, tenantId: 'tenant-1', actionId: 'action-1' });
  assert.equal(records.length, 1);
  assert.equal(records[0].recordId, 'r1');
});
