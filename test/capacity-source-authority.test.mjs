import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPACITY_AUTHORITY_DECISIONS,
  capacitySourceAuthorityHash,
  deriveCapacityStateWithAuthority,
  evaluateCapacitySourceAuthority,
  validateCapacitySourceAuthority
} from '../src/core/capacity-source-authority.mjs';

const NOW = new Date('2026-08-18T20:00:00.000Z');

function authority(overrides = {}) {
  return {
    schemaVersion: 1,
    authorityId: 'capacity-authority-1',
    tenantId: 'tenant-1',
    sourceSystem: 'wiserr',
    sourceAuthority: 'wiserr://capacity/owner-attestation',
    status: 'ACTIVE',
    validFrom: '2026-08-18T19:00:00.000Z',
    validUntil: '2026-08-18T23:00:00.000Z',
    scopeKeys: ['tenant:tenant-1:service:all'],
    permissions: {
      canAssertAvailability: true,
      canAssertConstraints: true
    },
    evidenceRef: 'wiserr://authority/capacity/1',
    notes: 'not authority-bearing',
    ...overrides
  };
}

function evidence(overrides = {}) {
  return {
    schemaVersion: 1,
    evidenceId: 'capacity-evidence-1',
    tenantId: 'tenant-1',
    scopeKey: 'tenant:tenant-1:service:all',
    sourceSystem: 'wiserr',
    sourceAuthority: 'wiserr://capacity/owner-attestation',
    asOf: '2026-08-18T19:55:00.000Z',
    validUntil: '2026-08-18T21:00:00.000Z',
    completeness: 'COMPLETE_FOR_PURPOSE',
    signals: [
      {
        signalId: 'available-1',
        verdict: 'AVAILABLE',
        authoritative: true,
        sourceRef: 'wiserr://capacity/attestation/1'
      }
    ],
    ...overrides
  };
}

test('current matching capacity authority permits authoritative availability', () => {
  const a = authority();
  const e = evidence();
  assert.equal(validateCapacitySourceAuthority(a), a);
  const decision = evaluateCapacitySourceAuthority({ evidence: e, authority: a, now: NOW });
  assert.equal(decision.decision, CAPACITY_AUTHORITY_DECISIONS.READY);
  const derived = deriveCapacityStateWithAuthority({ evidence: e, authority: a, now: NOW });
  assert.equal(derived.status, 'AVAILABLE');
  assert.equal(derived.demandThrottleRecommended, false);
  assert.equal(derived.authorityId, a.authorityId);
  assert.match(derived.authorityHash, /^[0-9a-f]{64}$/);
});

test('authoritative boolean cannot bypass a source that lacks availability permission', () => {
  const a = authority({ permissions: { canAssertAvailability: false, canAssertConstraints: true } });
  const decision = evaluateCapacitySourceAuthority({ evidence: evidence(), authority: a, now: NOW });
  assert.equal(decision.decision, 'DENY');
  assert.match(decision.reasons.join(','), /CAPACITY_SIGNAL_NOT_AUTHORIZED:available-1:AVAILABLE/);
  const derived = deriveCapacityStateWithAuthority({ evidence: evidence(), authority: a, now: NOW });
  assert.equal(derived.status, 'UNKNOWN');
  assert.equal(derived.demandThrottleRecommended, true);
});

test('constraint-only authority can throttle demand without gaining permission to assert availability', () => {
  const a = authority({ permissions: { canAssertAvailability: false, canAssertConstraints: true } });
  const constrained = evidence({
    signals: [{
      signalId: 'constraint-1',
      verdict: 'CONSTRAINED',
      authoritative: true,
      sourceRef: 'wiserr://capacity/constraint/1'
    }]
  });
  const derived = deriveCapacityStateWithAuthority({ evidence: constrained, authority: a, now: NOW });
  assert.equal(derived.status, 'CONSTRAINED');
  assert.equal(derived.demandThrottleRecommended, true);
});

test('cross-tenant, source, or scope authority mismatch fails closed', () => {
  for (const a of [
    authority({ tenantId: 'tenant-2' }),
    authority({ sourceAuthority: 'wiserr://capacity/other' }),
    authority({ scopeKeys: ['tenant:tenant-1:service:roofing'] })
  ]) {
    const derived = deriveCapacityStateWithAuthority({ evidence: evidence(), authority: a, now: NOW });
    assert.equal(derived.status, 'UNKNOWN');
    assert.equal(derived.demandThrottleRecommended, true);
  }
});

test('revoked, expired, or not-current authority cannot unlock capacity', () => {
  const cases = [
    authority({ status: 'REVOKED' }),
    authority({ validUntil: '2026-08-18T19:59:59.000Z' }),
    authority({ validFrom: '2026-08-18T20:01:00.000Z', validUntil: '2026-08-18T23:00:00.000Z' })
  ];
  for (const a of cases) {
    const derived = deriveCapacityStateWithAuthority({ evidence: evidence(), authority: a, now: NOW });
    assert.equal(derived.status, 'UNKNOWN');
    assert.equal(derived.demandThrottleRecommended, true);
  }
});

test('evidence cannot predate or outlive the authority that issued it', () => {
  const tooEarly = evidence({ asOf: '2026-08-18T18:59:00.000Z' });
  assert.equal(
    evaluateCapacitySourceAuthority({ evidence: tooEarly, authority: authority(), now: NOW }).decision,
    'DENY'
  );

  const tooLong = evidence({ validUntil: '2026-08-19T01:00:00.000Z' });
  const decision = evaluateCapacitySourceAuthority({ evidence: tooLong, authority: authority(), now: NOW });
  assert.equal(decision.decision, 'DENY');
  assert.match(decision.reasons.join(','), /CAPACITY_EVIDENCE_VALIDITY_EXCEEDS_AUTHORITY/);
});

test('authority hash excludes notes but binds permission and scope', () => {
  const base = authority();
  const noteChanged = authority({ notes: 'different operator note' });
  assert.equal(capacitySourceAuthorityHash(base), capacitySourceAuthorityHash(noteChanged));

  const permissionChanged = authority({ permissions: { canAssertAvailability: false, canAssertConstraints: true } });
  assert.notEqual(capacitySourceAuthorityHash(base), capacitySourceAuthorityHash(permissionChanged));

  const scopeChanged = authority({ scopeKeys: ['tenant:tenant-1:service:accounting'] });
  assert.notEqual(capacitySourceAuthorityHash(base), capacitySourceAuthorityHash(scopeChanged));
});
