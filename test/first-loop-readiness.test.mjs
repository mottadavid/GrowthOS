import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityExecutionProofHash } from '../src/core/capacity-execution-proof.mjs';
import { evaluateFirstLoopReadiness } from '../src/reactivation/first-loop-readiness.mjs';

const NOW = new Date('2026-08-19T12:00:00.000Z');
const SHA = 'a'.repeat(40);
const FINGERPRINT = 'b'.repeat(64);

function receipt({ dependencyId, contractName, capability, status = 'CERTIFIED' }) {
  return {
    schemaVersion: 1,
    dependencyId,
    repository: 'mottadavid/Wiserr-OS',
    contractName,
    contractVersion: '1',
    status,
    validatedCommitSha: SHA,
    authorityFingerprint: FINGERPRINT,
    validatedAt: '2026-08-19T11:00:00.000Z',
    validUntil: null,
    guardedPaths: ['authority/path.ts'],
    capabilities: { [capability]: true }
  };
}

function readReceipt(status = 'CERTIFIED') {
  return receipt({ dependencyId: 'wiserr-growth-snapshot-v1', contractName: 'wiserr-growth-snapshot', capability: 'readGrowthSnapshot', status });
}

function smsReceipt(status = 'CERTIFIED') {
  return receipt({ dependencyId: 'wiserr-reactivation-sms-v1', contractName: 'wiserr-reactivation-sms', capability: 'reactivationSmsExecution', status });
}

function capacityProof(overrides = {}) {
  const body = {
    schemaVersion: 1,
    tenantId: 'tenant-1',
    capacityBundleId: 'capacity-1',
    capacitySemanticHash: 'c'.repeat(64),
    evidenceId: 'evidence-1',
    authorityId: 'authority-1',
    authorityHash: 'd'.repeat(64),
    sourceSystem: 'wiserr-capacity',
    sourceAuthority: 'owner-attested-pilot',
    scopeKey: 'tenant',
    asOf: '2026-08-19T11:55:00.000Z',
    validUntil: '2026-08-19T12:05:00.000Z',
    derivedStatus: 'AVAILABLE',
    demandThrottleRecommended: false,
    authorityDecision: 'READY',
    ...overrides
  };
  return { ...body, proofHash: capacityExecutionProofHash(body) };
}

function executionRuntime() {
  return {
    tenantId: 'tenant-1',
    mode: 'EXECUTION_ENABLED',
    executionEnabled: true,
    executionStore: {},
    executionBlockers: []
  };
}

function evaluate(overrides = {}) {
  return evaluateFirstLoopReadiness({
    tenantId: 'tenant-1',
    runtime: executionRuntime(),
    growthSnapshotReceipt: readReceipt(),
    growthSnapshotCurrentCommitSha: SHA,
    growthSnapshotCurrentAuthorityFingerprint: FINGERPRINT,
    capacityProof: capacityProof(),
    smsReceipt: smsReceipt(),
    smsCurrentCommitSha: SHA,
    smsCurrentAuthorityFingerprint: FINGERPRINT,
    now: NOW,
    ...overrides
  });
}

test('first loop is READY only when runtime, read, capacity, and SMS authorities are all ready', () => {
  const report = evaluate();
  assert.equal(report.ready, true);
  assert.equal(report.decision, 'READY');
  assert.equal(report.blockers.length, 0);
  assert.deepEqual(report.checks, {
    runtimeExecutionEnabled: true,
    growthSnapshotReadCertified: true,
    capacityProofUsable: true,
    reactivationSmsCertified: true
  });
});

test('current candidate read authority blocks the loop without weakening other checks', () => {
  const report = evaluate({ growthSnapshotReceipt: readReceipt('CANDIDATE') });
  assert.equal(report.ready, false);
  assert.equal(report.blockers.some(item => item.code === 'WISERR_GROWTH_SNAPSHOT_READ_NOT_CERTIFIED'), true);
  assert.equal(report.checks.capacityProofUsable, true);
  assert.equal(report.checks.reactivationSmsCertified, true);
});

test('observed SMS authority blocks execution even when business-state read is certified', () => {
  const report = evaluate({ smsReceipt: smsReceipt('OBSERVED') });
  assert.equal(report.ready, false);
  assert.equal(report.blockers.some(item => item.code === 'WISERR_REACTIVATION_SMS_NOT_CERTIFIED'), true);
  assert.equal(report.checks.growthSnapshotReadCertified, true);
});

test('missing or expired capacity proof blocks demand execution', () => {
  const missing = evaluate({ capacityProof: null });
  assert.equal(missing.blockers.some(item => item.code === 'CAPACITY_PROOF_MISSING'), true);

  const expired = evaluate({ capacityProof: capacityProof({ validUntil: '2026-08-19T11:59:00.000Z' }) });
  assert.equal(expired.blockers.some(item => item.code === 'CAPACITY_PROOF_NOT_USABLE'), true);
  assert.equal(expired.checks.capacityProofUsable, false);
});

test('read-only runtime remains a blocker even when every upstream authority is certified', () => {
  const runtime = { tenantId: 'tenant-1', mode: 'READ_ONLY', executionEnabled: false, executionStore: null, executionBlockers: ['DEPLOYMENT_EXECUTION_DISABLED'] };
  const report = evaluate({ runtime });
  assert.equal(report.ready, false);
  const finding = report.blockers.find(item => item.code === 'RUNTIME_EXECUTION_DISABLED');
  assert.ok(finding);
  assert.deepEqual(finding.details.executionBlockers, ['DEPLOYMENT_EXECUTION_DISABLED']);
});

test('moved upstream authority without matching fingerprint blocks readiness', () => {
  const report = evaluate({ growthSnapshotCurrentCommitSha: 'e'.repeat(40), growthSnapshotCurrentAuthorityFingerprint: null });
  assert.equal(report.ready, false);
  const finding = report.blockers.find(item => item.code === 'WISERR_GROWTH_SNAPSHOT_READ_NOT_CERTIFIED');
  assert.ok(finding);
  assert.equal(finding.details.reasons.includes('UPSTREAM_MOVED_FINGERPRINT_UNVERIFIED'), true);
});
