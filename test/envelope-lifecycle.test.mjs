import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activateEnvelope,
  activateReplacement,
  assertActiveEnvelopeImmutable,
  autonomyDelegationHash,
  createDraftEnvelope,
  createReplacementDraft,
  envelopeLifecycleReceipt,
  evaluateEnvelopeActivation,
  expireEnvelope,
  revokeEnvelope
} from '../src/core/envelope-lifecycle.mjs';
import { envelopeAuthorityHash } from '../src/core/policy-receipts.mjs';

const NOW = new Date('2026-08-18T20:20:00.000Z');

function delegation(overrides = {}) {
  return {
    schemaVersion: 1,
    assertionId: 'delegation-1',
    tenantId: 'tenant-1',
    grantingActorId: 'owner-1',
    issuerSystem: 'wiserr',
    issuerAuthorityRef: 'wiserr-owner-authority:v1',
    status: 'ACTIVE',
    validFrom: '2026-08-18T19:00:00.000Z',
    validUntil: '2026-08-20T19:00:00.000Z',
    allowedDelegateSubjectIds: ['growth-strategist', 'reactivation-executor'],
    actionFamilies: ['REACTIVATION'],
    allowedAutonomyLevels: ['L3_APPROVAL_REQUIRED', 'L4_BOUNDED_AUTONOMOUS'],
    scopes: {
      channels: ['sms', 'email'],
      accountIds: ['wiserr-primary'],
      geographies: ['tampa-fl']
    },
    limitCeilings: {
      maxSpendUsdPerDay: 100,
      maxSpendUsdTotal: 500,
      maxChangePercent: 25,
      maxAttempts: 2,
      maxRecipients: 500
    },
    canActivateEnvelopes: true,
    canRevokeEnvelopes: true,
    evidenceRef: 'wiserr://authority/owner-1',
    notes: '',
    ...overrides
  };
}

function draft(overrides = {}) {
  return createDraftEnvelope({
    envelopeId: 'env-1',
    tenantId: 'tenant-1',
    actionFamily: 'REACTIVATION',
    delegateSubjectId: 'growth-strategist',
    autonomyLevel: 'L4_BOUNDED_AUTONOMOUS',
    validFrom: '2026-08-18T20:00:00.000Z',
    validUntil: '2026-08-19T20:00:00.000Z',
    channels: ['sms'],
    accountIds: ['wiserr-primary'],
    geographies: ['tampa-fl'],
    limits: {
      maxSpendUsdPerDay: 50,
      maxSpendUsdTotal: 200,
      maxChangePercent: 20,
      maxAttempts: 1,
      maxRecipients: 200
    },
    ...overrides
  });
}

test('activates only a draft fully inside externally delegated authority', () => {
  const d = draft();
  const a = delegation();
  const verdict = evaluateEnvelopeActivation({ envelope: d, assertion: a, actorId: 'owner-1', now: NOW });
  assert.equal(verdict.decision, 'ALLOW');
  const active = activateEnvelope({ envelope: d, assertion: a, actorId: 'owner-1', now: NOW });
  assert.equal(active.status, 'ACTIVE');
  assert.equal(active.delegateSubjectId, 'growth-strategist');
  assert.equal(active.authorityAssertionId, 'delegation-1');
  assert.equal(active.authorityAssertionHash, autonomyDelegationHash(a));
});

test('wrong granting actor cannot activate an envelope', () => {
  const verdict = evaluateEnvelopeActivation({ envelope: draft(), assertion: delegation(), actorId: 'not-owner', now: NOW });
  assert.equal(verdict.decision, 'DENY');
  assert.ok(verdict.reasons.includes('GRANTING_ACTOR_MISMATCH'));
});

test('delegation cannot authorize an unlisted delegate subject', () => {
  const verdict = evaluateEnvelopeActivation({
    envelope: draft({ delegateSubjectId: 'unknown-agent' }),
    assertion: delegation(),
    actorId: 'owner-1',
    now: NOW
  });
  assert.equal(verdict.decision, 'DENY');
  assert.ok(verdict.reasons.includes('DELEGATE_SUBJECT_NOT_AUTHORIZED'));
});

test('L5 permission does not implicitly grant L4', () => {
  const verdict = evaluateEnvelopeActivation({
    envelope: draft({ autonomyLevel: 'L4_BOUNDED_AUTONOMOUS' }),
    assertion: delegation({ allowedAutonomyLevels: ['L5_LOW_RISK_AUTONOMOUS'] }),
    actorId: 'owner-1',
    now: NOW
  });
  assert.equal(verdict.decision, 'DENY');
  assert.ok(verdict.reasons.includes('AUTONOMY_LEVEL_NOT_DELEGATED'));
});

test('scope and limit widening are denied deterministically', () => {
  const verdict = evaluateEnvelopeActivation({
    envelope: draft({
      channels: ['sms', 'whatsapp'],
      limits: {
        maxSpendUsdPerDay: 101,
        maxSpendUsdTotal: 501,
        maxChangePercent: 26,
        maxAttempts: 3,
        maxRecipients: 501
      }
    }),
    assertion: delegation(),
    actorId: 'owner-1',
    now: NOW
  });
  assert.equal(verdict.decision, 'DENY');
  for (const reason of ['CHANNEL_SCOPE_EXCEEDED','DAILY_SPEND_CEILING_EXCEEDED','TOTAL_SPEND_CEILING_EXCEEDED','CHANGE_CEILING_EXCEEDED','ATTEMPT_CEILING_EXCEEDED','RECIPIENT_CEILING_EXCEEDED']) {
    assert.ok(verdict.reasons.includes(reason));
  }
});

test('active envelope is immutable and must be replaced for material change', () => {
  const active = activateEnvelope({ envelope: draft(), assertion: delegation(), actorId: 'owner-1', now: NOW });
  assert.equal(assertActiveEnvelopeImmutable(active, structuredClone(active)), true);
  const changed = structuredClone(active);
  changed.limits.maxRecipients = 300;
  assert.throws(() => assertActiveEnvelopeImmutable(active, changed), /ACTIVE_ENVELOPE_IMMUTABLE/);

  const replacement = createReplacementDraft(active, {
    envelopeId: 'env-2',
    changes: { limits: { ...active.limits, maxRecipients: 300 } }
  });
  assert.equal(replacement.status, 'DRAFT');
  assert.equal(replacement.replacesEnvelopeId, 'env-1');
});

test('replacement activation atomically returns revoked prior envelope and active replacement', () => {
  const a = delegation();
  const active = activateEnvelope({ envelope: draft(), assertion: a, actorId: 'owner-1', now: NOW });
  const replacementDraft = createReplacementDraft(active, {
    envelopeId: 'env-2',
    changes: { limits: { ...active.limits, maxRecipients: 250 } }
  });
  const result = activateReplacement({ activeEnvelope: active, replacementDraft, assertion: a, actorId: 'owner-1', now: new Date('2026-08-18T20:21:00Z') });
  assert.equal(result.previous.status, 'REVOKED');
  assert.equal(result.replacement.status, 'ACTIVE');
  assert.equal(result.replacement.replacesEnvelopeId, 'env-1');
});

test('revocation requires explicit delegated revocation authority', () => {
  const a = delegation();
  const active = activateEnvelope({ envelope: draft(), assertion: a, actorId: 'owner-1', now: NOW });
  assert.throws(() => revokeEnvelope({ envelope: active, assertion: delegation({ canRevokeEnvelopes: false }), actorId: 'owner-1', now: NOW, reason: 'stop' }), /DELEGATION_CANNOT_REVOKE/);
  const revoked = revokeEnvelope({ envelope: active, assertion: a, actorId: 'owner-1', now: NOW, reason: 'owner stop' });
  assert.equal(revoked.status, 'REVOKED');
});

test('expiration is time-based and does not require granting actor', () => {
  const active = activateEnvelope({ envelope: draft(), assertion: delegation(), actorId: 'owner-1', now: NOW });
  assert.throws(() => expireEnvelope(active, new Date('2026-08-19T19:00:00Z')), /ENVELOPE_NOT_EXPIRED_YET/);
  const expired = expireEnvelope(active, new Date('2026-08-19T21:00:00Z'));
  assert.equal(expired.status, 'EXPIRED');
});

test('policy envelope authority hash binds delegate and activation authority', () => {
  const a = delegation();
  const active = activateEnvelope({ envelope: draft(), assertion: a, actorId: 'owner-1', now: NOW });
  const changedDelegate = { ...active, delegateSubjectId: 'reactivation-executor' };
  const changedAuthority = { ...active, authorityAssertionHash: 'f'.repeat(64) };
  assert.notEqual(envelopeAuthorityHash(active), envelopeAuthorityHash(changedDelegate));
  assert.notEqual(envelopeAuthorityHash(active), envelopeAuthorityHash(changedAuthority));
});

test('lifecycle receipt is tamper-evident and contains only hashes/authority references', () => {
  const a = delegation();
  const d = draft({ notes: 'PRIVATE_OPERATOR_NOTE' });
  const active = activateEnvelope({ envelope: d, assertion: a, actorId: 'owner-1', now: NOW });
  const receipt = envelopeLifecycleReceipt({ eventType: 'ACTIVATED', before: d, after: active, actorId: 'owner-1', assertion: a, occurredAt: NOW });
  assert.match(receipt.receiptHash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(receipt).includes('PRIVATE_OPERATOR_NOTE'), false);
  assert.equal(receipt.assertionId, 'delegation-1');
});
