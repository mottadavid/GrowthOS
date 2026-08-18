import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import {
  createDurableDraftEnvelope,
  loadDurableActionEnvelope,
  listDurableActionEnvelopes,
  activateDurableActionEnvelope,
  revokeDurableActionEnvelope,
  expireDurableActionEnvelope,
  replaceDurableActionEnvelope,
  actionEnvelopeRecoveryIndex
} from '../src/runtime/action-envelope-repository.mjs';
import { evaluateActionPolicy } from '../src/core/control-plane.mjs';

const T0 = new Date('2026-08-18T20:00:00.000Z');

function delegation(overrides = {}) {
  return {
    schemaVersion: 1,
    assertionId: 'delegation-1',
    tenantId: 'tenant-1',
    grantingActorId: 'owner-1',
    issuerSystem: 'wiserr',
    issuerAuthorityRef: 'wiserr://authority/owner-1/growth',
    status: 'ACTIVE',
    validFrom: '2026-08-18T19:00:00.000Z',
    validUntil: '2026-08-20T19:00:00.000Z',
    allowedDelegateSubjectIds: ['growth-strategist'],
    actionFamilies: ['REACTIVATION'],
    allowedAutonomyLevels: ['L3_APPROVAL_REQUIRED', 'L4_BOUNDED_AUTONOMOUS'],
    scopes: {
      channels: ['sms'],
      accountIds: ['wiserr-primary'],
      geographies: ['tampa-fl']
    },
    limitCeilings: {
      maxSpendUsdPerDay: 100,
      maxSpendUsdTotal: 500,
      maxChangePercent: 20,
      maxAttempts: 2,
      maxRecipients: 200
    },
    canActivateEnvelopes: true,
    canRevokeEnvelopes: true,
    evidenceRef: 'wiserr://authority/owner-1/growth',
    notes: '',
    ...overrides
  };
}

function envelopeInput(overrides = {}) {
  return {
    envelopeId: 'env-1',
    tenantId: 'tenant-1',
    actionFamily: 'REACTIVATION',
    delegateSubjectId: 'growth-strategist',
    autonomyLevel: 'L4_BOUNDED_AUTONOMOUS',
    validFrom: '2026-08-18T19:00:00.000Z',
    validUntil: '2026-08-19T19:00:00.000Z',
    channels: ['sms'],
    accountIds: ['wiserr-primary'],
    geographies: ['tampa-fl'],
    limits: {
      maxSpendUsdPerDay: 50,
      maxSpendUsdTotal: 200,
      maxChangePercent: 10,
      maxAttempts: 1,
      maxRecipients: 100
    },
    requiresApproval: false,
    approvalId: null,
    approvedActionHash: null,
    policyVersion: 'v1',
    notes: 'private operator note',
    ...overrides
  };
}

function action() {
  return {
    schemaVersion: 1,
    actionId: 'action-1',
    tenantId: 'tenant-1',
    actionFamily: 'REACTIVATION',
    actionType: 'SEND_REACTIVATION_SEQUENCE',
    channel: 'sms',
    accountId: 'wiserr-primary',
    geography: 'tampa-fl',
    requestedAt: T0.toISOString(),
    requestedBy: 'growth-strategist',
    businessSnapshotId: 'snapshot-1',
    opportunityId: 'opp-1',
    experimentId: 'exp-1',
    inputs: { demandIncreasing: false },
    expectedCost: { spendUsd: 10, recipients: 50 },
    currentTotalSpendUsd: 0,
    currentDailySpendUsd: 0,
    changePercent: 0,
    attemptNumber: 1,
    approvalId: null
  };
}

test('draft creation is idempotent and indexed by delegate plus action family', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const first = await createDurableDraftEnvelope({ store, input: envelopeInput(), now: T0 });
  const second = await createDurableDraftEnvelope({ store, input: envelopeInput(), now: T0 });
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.record.indexKey, actionEnvelopeRecoveryIndex({ delegateSubjectId: 'growth-strategist', actionFamily: 'REACTIVATION' }));

  const found = await listDurableActionEnvelopes({
    store, tenantId: 'tenant-1', delegateSubjectId: 'growth-strategist', actionFamily: 'REACTIVATION'
  });
  assert.equal(found.length, 1);
});

test('activation persists exact upstream delegation provenance and survives restart recovery', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await createDurableDraftEnvelope({ store, input: envelopeInput(), now: T0 });
  const active = await activateDurableActionEnvelope({
    store, tenantId: 'tenant-1', envelopeId: 'env-1', assertion: delegation(), actorId: 'owner-1', now: T0
  });
  assert.equal(active.payload.status, 'ACTIVE');
  assert.equal(active.payload.authorityAssertionId, 'delegation-1');
  assert.match(active.payload.authorityAssertionHash, /^[a-f0-9]{64}$/);

  const recovered = await loadDurableActionEnvelope({ store, tenantId: 'tenant-1', envelopeId: 'env-1' });
  assert.equal(recovered.payload.status, 'ACTIVE');
  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: 'env-1' });
  const activation = events.find(event => event.eventType === 'growth.action_envelope.active');
  assert.ok(activation);
  assert.equal(activation.payload.issuerAuthorityRef, 'wiserr://authority/owner-1/growth');
  assert.equal(JSON.stringify(activation).includes('private operator note'), false);
});

test('wrong actor or scope widening cannot activate durable authority', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await createDurableDraftEnvelope({ store, input: envelopeInput(), now: T0 });
  await assert.rejects(
    () => activateDurableActionEnvelope({ store, tenantId: 'tenant-1', envelopeId: 'env-1', assertion: delegation(), actorId: 'not-owner', now: T0 }),
    /GRANTING_ACTOR_MISMATCH/
  );
  assert.equal((await loadDurableActionEnvelope({ store, tenantId: 'tenant-1', envelopeId: 'env-1' })).payload.status, 'DRAFT');

  const store2 = new AtomicInMemoryRuntimeStore();
  await createDurableDraftEnvelope({ store: store2, input: envelopeInput({ channels: ['email'] }), now: T0 });
  await assert.rejects(
    () => activateDurableActionEnvelope({ store: store2, tenantId: 'tenant-1', envelopeId: 'env-1', assertion: delegation(), actorId: 'owner-1', now: T0 }),
    /CHANNEL_SCOPE_EXCEEDED/
  );
});

test('revocation remains load-bearing after recovery and control plane denies the old envelope', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await createDurableDraftEnvelope({ store, input: envelopeInput(), now: T0 });
  await activateDurableActionEnvelope({ store, tenantId: 'tenant-1', envelopeId: 'env-1', assertion: delegation(), actorId: 'owner-1', now: T0 });
  const revoked = await revokeDurableActionEnvelope({
    store,
    tenantId: 'tenant-1',
    envelopeId: 'env-1',
    assertion: delegation(),
    actorId: 'owner-1',
    reason: 'owner disabled autonomous reactivation',
    now: new Date('2026-08-18T20:05:00Z')
  });
  assert.equal(revoked.payload.status, 'REVOKED');

  const recovered = await loadDurableActionEnvelope({ store, tenantId: 'tenant-1', envelopeId: 'env-1' });
  const decision = evaluateActionPolicy({ action: action(), envelope: recovered.payload, now: new Date('2026-08-18T20:06:00Z') });
  assert.equal(decision.decision, 'DENY');
  assert.ok(decision.reasons.includes('ENVELOPE_REVOKED'));
});

test('time expiration persists and prevents later execution', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await createDurableDraftEnvelope({ store, input: envelopeInput({ validUntil: '2026-08-18T20:30:00.000Z' }), now: T0 });
  await activateDurableActionEnvelope({ store, tenantId: 'tenant-1', envelopeId: 'env-1', assertion: delegation(), actorId: 'owner-1', now: T0 });
  const expired = await expireDurableActionEnvelope({ store, tenantId: 'tenant-1', envelopeId: 'env-1', now: new Date('2026-08-18T20:31:00Z') });
  assert.equal(expired.payload.status, 'EXPIRED');
  const decision = evaluateActionPolicy({ action: action(), envelope: expired.payload, now: new Date('2026-08-18T20:31:01Z') });
  assert.equal(decision.decision, 'DENY');
  assert.ok(decision.reasons.includes('ENVELOPE_EXPIRED'));
});

test('replacement validates first, revokes old before activating new, and preserves lineage', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await createDurableDraftEnvelope({ store, input: envelopeInput(), now: T0 });
  await activateDurableActionEnvelope({ store, tenantId: 'tenant-1', envelopeId: 'env-1', assertion: delegation(), actorId: 'owner-1', now: T0 });

  const replaced = await replaceDurableActionEnvelope({
    store,
    tenantId: 'tenant-1',
    activeEnvelopeId: 'env-1',
    replacementEnvelopeId: 'env-2',
    changes: { limits: { ...envelopeInput().limits, maxRecipients: 80 } },
    assertion: delegation(),
    actorId: 'owner-1',
    now: new Date('2026-08-18T20:10:00Z')
  });
  assert.equal(replaced.previous.payload.status, 'REVOKED');
  assert.equal(replaced.replacement.payload.status, 'ACTIVE');
  assert.equal(replaced.replacement.payload.replacesEnvelopeId, 'env-1');
  assert.equal(replaced.replacement.payload.limits.maxRecipients, 80);
});

test('replacement widening outside delegation fails before revoking current authority', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await createDurableDraftEnvelope({ store, input: envelopeInput(), now: T0 });
  await activateDurableActionEnvelope({ store, tenantId: 'tenant-1', envelopeId: 'env-1', assertion: delegation(), actorId: 'owner-1', now: T0 });

  await assert.rejects(
    () => replaceDurableActionEnvelope({
      store,
      tenantId: 'tenant-1',
      activeEnvelopeId: 'env-1',
      replacementEnvelopeId: 'env-2',
      changes: { limits: { ...envelopeInput().limits, maxRecipients: 500 } },
      assertion: delegation(),
      actorId: 'owner-1',
      now: new Date('2026-08-18T20:10:00Z')
    }),
    /RECIPIENT_CEILING_EXCEEDED/
  );

  const current = await loadDurableActionEnvelope({ store, tenantId: 'tenant-1', envelopeId: 'env-1' });
  assert.equal(current.payload.status, 'ACTIVE');
  assert.equal(await loadDurableActionEnvelope({ store, tenantId: 'tenant-1', envelopeId: 'env-2' }), null);
});

test('tampered secondary index fails closed on recovery', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const created = await createDurableDraftEnvelope({ store, input: envelopeInput(), now: T0 });
  const key = store.recordKey({ tenantId: 'tenant-1', recordType: 'action_envelope', recordId: created.record.recordId });
  store.records.get(key).indexKey = 'wrong-index';
  await assert.rejects(
    () => loadDurableActionEnvelope({ store, tenantId: 'tenant-1', envelopeId: 'env-1' }),
    /DURABLE_ACTION_ENVELOPE_IDENTITY_MISMATCH/
  );
});
