import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityForBusinessState, deriveCapacityState } from '../src/core/capacity-evidence.mjs';

const NOW = new Date('2026-08-18T20:00:00.000Z');

function evidence(overrides = {}) {
  return {
    schemaVersion: 1,
    evidenceId: 'capacity-1',
    tenantId: 'tenant-1',
    scopeKey: 'tenant-1:roofing:tampa:next-30-days',
    sourceSystem: 'wiserr',
    sourceAuthority: 'buildos-capacity-v1',
    sourceContractId: null,
    asOf: '2026-08-18T19:55:00.000Z',
    validUntil: '2026-08-18T21:00:00.000Z',
    completeness: 'COMPLETE_FOR_PURPOSE',
    signals: [
      {
        signalId: 'headroom',
        verdict: 'AVAILABLE',
        authoritative: true,
        sourceRef: 'capacity-window-1',
        observedValue: 3,
        threshold: 1,
        units: 'project-start-slots',
        summary: 'Three certified start slots are available in the scope window.'
      }
    ],
    notes: '',
    ...overrides
  };
}

test('requires complete fresh authoritative evidence to return AVAILABLE', () => {
  const result = deriveCapacityState(evidence(), { now: NOW });
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.demandThrottleRecommended, false);
});

test('partial evidence cannot manufacture availability', () => {
  const result = deriveCapacityState(evidence({ completeness: 'PARTIAL' }), { now: NOW });
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(result.demandThrottleRecommended, true);
  assert.ok(result.reasons.includes('CAPACITY_EVIDENCE_PARTIAL'));
});

test('non-authoritative available signal cannot authorize demand', () => {
  const result = deriveCapacityState(evidence({
    signals: [{ signalId: 'guess', verdict: 'AVAILABLE', authoritative: false, sourceRef: 'derived-guess' }]
  }), { now: NOW });
  assert.equal(result.status, 'UNKNOWN');
  assert.ok(result.reasons.includes('NO_AUTHORITATIVE_CAPACITY_SIGNAL'));
});

test('authoritative constrained evidence throttles demand even when completeness is partial', () => {
  const result = deriveCapacityState(evidence({
    completeness: 'PARTIAL',
    signals: [{ signalId: 'backlog', verdict: 'CONSTRAINED', authoritative: true, sourceRef: 'ops-backlog' }]
  }), { now: NOW });
  assert.equal(result.status, 'CONSTRAINED');
  assert.equal(result.demandThrottleRecommended, true);
});

test('FULL wins over conflicting optimistic evidence', () => {
  const result = deriveCapacityState(evidence({
    signals: [
      { signalId: 'available', verdict: 'AVAILABLE', authoritative: true, sourceRef: 'calendar' },
      { signalId: 'full', verdict: 'FULL', authoritative: true, sourceRef: 'crew-authority' }
    ]
  }), { now: NOW });
  assert.equal(result.status, 'FULL');
  assert.ok(result.reasons.includes('CONFLICTING_CAPACITY_SIGNALS_FULL_WINS'));
});

test('CONSTRAINED wins over AVAILABLE when both are authoritative', () => {
  const result = deriveCapacityState(evidence({
    signals: [
      { signalId: 'available', verdict: 'AVAILABLE', authoritative: true, sourceRef: 'calendar' },
      { signalId: 'constraint', verdict: 'CONSTRAINED', authoritative: true, sourceRef: 'staffing' }
    ]
  }), { now: NOW });
  assert.equal(result.status, 'CONSTRAINED');
  assert.ok(result.reasons.includes('CONFLICTING_CAPACITY_SIGNALS_CONSTRAINT_WINS'));
});

test('stale or expired evidence returns UNKNOWN and throttles demand', () => {
  const stale = deriveCapacityState(evidence({ completeness: 'STALE' }), { now: NOW });
  assert.equal(stale.status, 'UNKNOWN');
  assert.equal(stale.demandThrottleRecommended, true);

  const expired = deriveCapacityState(evidence({ validUntil: '2026-08-18T19:00:00.000Z' }), { now: NOW });
  assert.equal(expired.status, 'UNKNOWN');
  assert.ok(expired.reasons.includes('CAPACITY_EVIDENCE_EXPIRED'));
});

test('capacity business-state projection retains authority reference and scope', () => {
  const result = capacityForBusinessState(evidence(), { now: NOW });
  assert.equal(result.status, 'AVAILABLE');
  assert.equal(result.signals[0].authority, 'buildos-capacity-v1');
  assert.equal(result.signals[0].scopeKey, 'tenant-1:roofing:tampa:next-30-days');
});
