import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPSTREAM_AUTHORITY_DECISIONS,
  evaluateUpstreamAuthority,
  upstreamAuthorityLockFingerprint
} from '../src/core/upstream-authority.mjs';

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const FP_A = '1'.repeat(64);
const FP_B = '2'.repeat(64);

function receipt(overrides = {}) {
  return {
    schemaVersion: 1,
    dependencyId: 'wiserr-growth-snapshot-v1',
    system: 'WISERR_OS',
    repository: 'mottadavid/Wiserr-OS',
    contractName: 'growth-snapshot',
    contractVersion: '1',
    status: 'CERTIFIED',
    validatedCommitSha: COMMIT_A,
    authorityFingerprint: FP_A,
    validatedAt: '2026-08-18T19:00:00.000Z',
    validUntil: null,
    guardedPaths: ['server/growth/growthSnapshotService.ts'],
    capabilities: {
      readGrowthSnapshot: true,
      reactivationSmsExecution: false
    },
    evidence: [],
    notes: '',
    ...overrides
  };
}

test('certified exact-head authority is ready when required capabilities are certified', () => {
  const result = evaluateUpstreamAuthority({
    receipt: receipt(),
    currentCommitSha: COMMIT_A,
    requiredCapabilities: ['readGrowthSnapshot']
  });
  assert.equal(result.decision, UPSTREAM_AUTHORITY_DECISIONS.READY);
});

test('candidate authority cannot unlock production execution', () => {
  const result = evaluateUpstreamAuthority({
    receipt: receipt({ status: 'CANDIDATE' }),
    currentCommitSha: COMMIT_A,
    requiredCapabilities: ['readGrowthSnapshot']
  });
  assert.equal(result.decision, UPSTREAM_AUTHORITY_DECISIONS.REVIEW_REQUIRED);
  assert.ok(result.reasons.includes('UPSTREAM_AUTHORITY_CANDIDATE'));
});

test('missing or false required capability denies rather than guessing', () => {
  const falseCapability = evaluateUpstreamAuthority({
    receipt: receipt(),
    currentCommitSha: COMMIT_A,
    requiredCapabilities: ['reactivationSmsExecution']
  });
  assert.equal(falseCapability.decision, UPSTREAM_AUTHORITY_DECISIONS.DENY);

  const absentCapability = evaluateUpstreamAuthority({
    receipt: receipt(),
    currentCommitSha: COMMIT_A,
    requiredCapabilities: ['lunaCampaignContext']
  });
  assert.equal(absentCapability.decision, UPSTREAM_AUTHORITY_DECISIONS.DENY);
});

test('moved upstream head requires review when current authority fingerprint is unknown', () => {
  const result = evaluateUpstreamAuthority({
    receipt: receipt(),
    currentCommitSha: COMMIT_B,
    requiredCapabilities: ['readGrowthSnapshot']
  });
  assert.equal(result.decision, UPSTREAM_AUTHORITY_DECISIONS.REVIEW_REQUIRED);
  assert.ok(result.reasons.includes('UPSTREAM_MOVED_FINGERPRINT_UNVERIFIED'));
});

test('unrelated upstream movement remains ready only after authority fingerprint is reverified unchanged', () => {
  const result = evaluateUpstreamAuthority({
    receipt: receipt(),
    currentCommitSha: COMMIT_B,
    currentAuthorityFingerprint: FP_A,
    requiredCapabilities: ['readGrowthSnapshot']
  });
  assert.equal(result.decision, UPSTREAM_AUTHORITY_DECISIONS.READY);
});

test('changed authority fingerprint requires review', () => {
  const result = evaluateUpstreamAuthority({
    receipt: receipt(),
    currentCommitSha: COMMIT_B,
    currentAuthorityFingerprint: FP_B,
    requiredCapabilities: ['readGrowthSnapshot']
  });
  assert.equal(result.decision, UPSTREAM_AUTHORITY_DECISIONS.REVIEW_REQUIRED);
  assert.ok(result.reasons.includes('UPSTREAM_AUTHORITY_CHANGED'));
});

test('revoked authority denies even when commit and fingerprint match', () => {
  const result = evaluateUpstreamAuthority({
    receipt: receipt({ status: 'REVOKED' }),
    currentCommitSha: COMMIT_A,
    currentAuthorityFingerprint: FP_A,
    requiredCapabilities: ['readGrowthSnapshot']
  });
  assert.equal(result.decision, UPSTREAM_AUTHORITY_DECISIONS.DENY);
  assert.ok(result.reasons.includes('UPSTREAM_AUTHORITY_REVOKED'));
});

test('expired certification requires review', () => {
  const result = evaluateUpstreamAuthority({
    receipt: receipt({ validUntil: '2026-08-18T18:00:00.000Z' }),
    currentCommitSha: COMMIT_A,
    now: new Date('2026-08-18T19:00:00.000Z'),
    requiredCapabilities: ['readGrowthSnapshot']
  });
  assert.equal(result.decision, UPSTREAM_AUTHORITY_DECISIONS.REVIEW_REQUIRED);
  assert.ok(result.reasons.includes('UPSTREAM_AUTHORITY_EXPIRED'));
});

test('lock fingerprint changes when required capability set changes', () => {
  const a = upstreamAuthorityLockFingerprint(receipt(), ['readGrowthSnapshot']);
  const b = upstreamAuthorityLockFingerprint(receipt(), ['readGrowthSnapshot', 'reactivationSmsExecution']);
  assert.notEqual(a, b);
});
