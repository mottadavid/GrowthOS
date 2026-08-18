import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateWiserrGrowthSnapshotReadAuthority,
  readWiserrGrowthSnapshot,
  validateGrowthSnapshotFreshness
} from '../src/integrations/wiserr/read-client.mjs';

const SHA = 'a'.repeat(40);
const FINGERPRINT = 'b'.repeat(64);
const NOW = new Date('2026-08-18T20:00:00.000Z');

function receipt(overrides = {}) {
  return {
    schemaVersion: 1,
    dependencyId: 'wiserr-growth-snapshot-v1',
    system: 'WISERR_OS',
    repository: 'mottadavid/Wiserr-OS',
    contractName: 'wiserr-growth-snapshot',
    contractVersion: '1',
    status: 'CERTIFIED',
    validatedCommitSha: SHA,
    authorityFingerprint: FINGERPRINT,
    validatedAt: '2026-08-18T19:00:00.000Z',
    validUntil: null,
    guardedPaths: [
      'server/growth/growthSnapshotService.ts',
      'tests/growth/growthSnapshotService.test.ts',
      'docs/growth/GROWTHOS_READ_CONTRACT.md'
    ],
    capabilities: {
      aggregateGrowthSnapshotProducer: true,
      readGrowthSnapshot: true,
      reactivationSmsExecution: false,
      reactivationEmailExecution: false,
      lunaCampaignContext: false,
      canonicalBookingOutcomeEvents: false,
      canonicalWonRevenueOutcomeEvents: false
    },
    evidence: [],
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    tenantId: 'tenant-1',
    generatedAt: '2026-08-18T19:55:00.000Z',
    completeness: 'PARTIAL',
    capacity: {
      status: 'UNKNOWN',
      demandThrottleRecommended: false,
      reason: 'Capacity authority not certified.'
    },
    reactivation: {
      cohortDefinitionId: 'non-won-inactive-leads',
      cohortDefinitionVersion: '1:90d',
      dormantCount: 120,
      eligibleByChannel: { sms: 80, email: 100, whatsapp: 60 },
      suppressedCount: 20,
      latestRelevantActivityAt: '2026-08-01T12:00:00.000Z'
    },
    capabilities: {
      reactivationSms: false,
      reactivationEmail: false,
      reactivationWhatsapp: false,
      lunaReplyHandling: false,
      bookingOutcomes: false
    },
    ...overrides
  };
}

test('candidate or uncertified read authority refuses before transport invocation', async () => {
  let calls = 0;
  await assert.rejects(
    () => readWiserrGrowthSnapshot({
      receipt: receipt({ status: 'CANDIDATE', capabilities: { ...receipt().capabilities, readGrowthSnapshot: false } }),
      currentCommitSha: SHA,
      tenantId: 'tenant-1',
      dormantDays: 90,
      transport: async () => { calls += 1; return snapshot(); },
      now: NOW
    }),
    /WISERR_GROWTH_SNAPSHOT_READ_NOT_CERTIFIED/
  );
  assert.equal(calls, 0);
});

test('certified exact authority returns a validated tenant-scoped snapshot', async () => {
  let request = null;
  const result = await readWiserrGrowthSnapshot({
    receipt: receipt(),
    currentCommitSha: SHA,
    tenantId: 'tenant-1',
    dormantDays: 90,
    transport: async (input) => { request = input; return snapshot(); },
    now: NOW
  });
  assert.deepEqual(request, { tenantId: 'tenant-1', dormantDays: 90 });
  assert.equal(result.snapshot.snapshotId, 'snapshot-1');
  assert.equal(result.authority.authorityFingerprint, FINGERPRINT);
  assert.match(result.authority.lockFingerprint, /^[0-9a-f]{64}$/);
});

test('cross-tenant response is rejected even after read authority is certified', async () => {
  await assert.rejects(
    () => readWiserrGrowthSnapshot({
      receipt: receipt(),
      currentCommitSha: SHA,
      tenantId: 'tenant-1',
      dormantDays: 90,
      transport: async () => snapshot({ tenantId: 'tenant-2' }),
      now: NOW
    }),
    /WISERR_GROWTH_SNAPSHOT_TENANT_MISMATCH/
  );
});

test('stale and materially future snapshots fail closed', () => {
  assert.throws(
    () => validateGrowthSnapshotFreshness(snapshot({ generatedAt: '2026-08-18T19:30:00.000Z' }), { now: NOW, maxAgeMinutes: 15 }),
    /WISERR_GROWTH_SNAPSHOT_STALE/
  );
  assert.throws(
    () => validateGrowthSnapshotFreshness(snapshot({ generatedAt: '2026-08-18T20:10:00.000Z' }), { now: NOW, maxFutureSkewMinutes: 2 }),
    /WISERR_GROWTH_SNAPSHOT_FROM_FUTURE/
  );
});

test('upstream movement requires fingerprint revalidation before transport', async () => {
  let calls = 0;
  const movedSha = 'c'.repeat(40);
  const authority = evaluateWiserrGrowthSnapshotReadAuthority({
    receipt: receipt(),
    currentCommitSha: movedSha,
    currentAuthorityFingerprint: null,
    now: NOW
  });
  assert.equal(authority.decision, 'REVIEW_REQUIRED');

  await assert.rejects(
    () => readWiserrGrowthSnapshot({
      receipt: receipt(),
      currentCommitSha: movedSha,
      tenantId: 'tenant-1',
      dormantDays: 90,
      transport: async () => { calls += 1; return snapshot(); },
      now: NOW
    }),
    /WISERR_GROWTH_SNAPSHOT_READ_NOT_CERTIFIED/
  );
  assert.equal(calls, 0);
});

test('unrelated upstream movement may read only after the authority fingerprint is reverified unchanged', async () => {
  const result = await readWiserrGrowthSnapshot({
    receipt: receipt(),
    currentCommitSha: 'd'.repeat(40),
    currentAuthorityFingerprint: FINGERPRINT,
    tenantId: 'tenant-1',
    dormantDays: 90,
    transport: async () => snapshot(),
    now: NOW
  });
  assert.equal(result.snapshot.tenantId, 'tenant-1');
});
