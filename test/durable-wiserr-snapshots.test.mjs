import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import {
  readAndPersistWiserrGrowthSnapshot,
  loadDurableWiserrGrowthSnapshot,
  listDurableWiserrGrowthSnapshots
} from '../src/runtime/wiserr-snapshot-repository.mjs';

const NOW = new Date('2026-08-18T21:00:00.000Z');
const FP = 'a'.repeat(64);
const LOCK = 'b'.repeat(64);
const RECEIPT = {
  schemaVersion: 1,
  dependencyId: 'wiserr-growth-snapshot-v1',
  system: 'WISERR_OS',
  repository: 'mottadavid/Wiserr-OS',
  contractName: 'wiserr-growth-snapshot',
  contractVersion: '1',
  status: 'CERTIFIED',
  validatedCommitSha: '1'.repeat(40),
  authorityFingerprint: FP,
  validatedAt: '2026-08-18T20:00:00.000Z',
  validUntil: null,
  guardedPaths: ['server/growth/growthSnapshotService.ts'],
  capabilities: { readGrowthSnapshot: true }
};

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    tenantId: 'tenant-1',
    generatedAt: '2026-08-18T20:59:00.000Z',
    completeness: 'PARTIAL',
    capacity: { status: 'UNKNOWN', demandThrottleRecommended: false, reason: 'capacity authority not yet certified' },
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

function transportFor(value = snapshot()) {
  return async ({ tenantId, dormantDays }) => {
    assert.equal(tenantId, 'tenant-1');
    assert.equal(dormantDays, 90);
    return structuredClone(value);
  };
}

test('certified read persists exact snapshot and authority proof atomically', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const result = await readAndPersistWiserrGrowthSnapshot({
    store,
    receipt: RECEIPT,
    currentCommitSha: RECEIPT.validatedCommitSha,
    currentAuthorityFingerprint: FP,
    tenantId: 'tenant-1',
    dormantDays: 90,
    transport: transportFor(),
    now: NOW
  });
  assert.equal(result.idempotent, false);
  assert.equal(result.record.recordId, 'snapshot-1');
  assert.equal(result.record.indexKey, 'wiserr-growth-snapshot-v1');
  assert.equal(result.record.payload.snapshot.tenantId, 'tenant-1');
  assert.equal(result.record.payload.authority.authorityFingerprint, FP);
  assert.match(result.record.payload.snapshotHash, /^[0-9a-f]{64}$/);
});

test('uncertified upstream refuses before transport and persists nothing', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  let called = false;
  const candidate = { ...RECEIPT, status: 'CANDIDATE' };
  await assert.rejects(
    () => readAndPersistWiserrGrowthSnapshot({
      store,
      receipt: candidate,
      currentCommitSha: candidate.validatedCommitSha,
      currentAuthorityFingerprint: candidate.authorityFingerprint,
      tenantId: 'tenant-1',
      dormantDays: 90,
      transport: async () => { called = true; return snapshot(); },
      now: NOW
    }),
    /WISERR_GROWTH_SNAPSHOT_READ_NOT_CERTIFIED/
  );
  assert.equal(called, false);
  const records = await listDurableWiserrGrowthSnapshots({ store, tenantId: 'tenant-1', dependencyId: candidate.dependencyId });
  assert.equal(records.length, 0);
});

test('cross-tenant and stale snapshots never become durable provenance', async () => {
  for (const bad of [
    snapshot({ tenantId: 'tenant-2' }),
    snapshot({ generatedAt: '2026-08-18T19:00:00.000Z' })
  ]) {
    const store = new AtomicInMemoryRuntimeStore();
    await assert.rejects(
      () => readAndPersistWiserrGrowthSnapshot({
        store,
        receipt: RECEIPT,
        currentCommitSha: RECEIPT.validatedCommitSha,
        currentAuthorityFingerprint: FP,
        tenantId: 'tenant-1',
        dormantDays: 90,
        transport: transportFor(bad),
        now: NOW
      }),
      /WISERR_GROWTH_SNAPSHOT_TENANT_MISMATCH|WISERR_GROWTH_SNAPSHOT_STALE/
    );
  }
});

test('same snapshot and semantic authority replay idempotently across unrelated upstream commit movement', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const first = await readAndPersistWiserrGrowthSnapshot({
    store,
    receipt: RECEIPT,
    currentCommitSha: RECEIPT.validatedCommitSha,
    currentAuthorityFingerprint: FP,
    tenantId: 'tenant-1',
    dormantDays: 90,
    transport: transportFor(),
    now: NOW
  });
  assert.equal(first.idempotent, false);

  const movedSha = '2'.repeat(40);
  const second = await readAndPersistWiserrGrowthSnapshot({
    store,
    receipt: RECEIPT,
    currentCommitSha: movedSha,
    currentAuthorityFingerprint: FP,
    tenantId: 'tenant-1',
    dormantDays: 90,
    transport: transportFor(),
    now: NOW
  });
  assert.equal(second.idempotent, true);
});

test('same snapshot ID with changed snapshot semantics fails closed', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await readAndPersistWiserrGrowthSnapshot({
    store,
    receipt: RECEIPT,
    currentCommitSha: RECEIPT.validatedCommitSha,
    currentAuthorityFingerprint: FP,
    tenantId: 'tenant-1',
    dormantDays: 90,
    transport: transportFor(),
    now: NOW
  });

  await assert.rejects(
    () => readAndPersistWiserrGrowthSnapshot({
      store,
      receipt: RECEIPT,
      currentCommitSha: RECEIPT.validatedCommitSha,
      currentAuthorityFingerprint: FP,
      tenantId: 'tenant-1',
      dormantDays: 90,
      transport: transportFor(snapshot({ reactivation: { ...snapshot().reactivation, dormantCount: 121 } })),
      now: NOW
    }),
    /DURABLE_WISERR_SNAPSHOT_CONFLICT/
  );
});

test('same snapshot ID under changed semantic authority fails closed', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await readAndPersistWiserrGrowthSnapshot({
    store,
    receipt: RECEIPT,
    currentCommitSha: RECEIPT.validatedCommitSha,
    currentAuthorityFingerprint: FP,
    tenantId: 'tenant-1',
    dormantDays: 90,
    transport: transportFor(),
    now: NOW
  });

  const changedFp = 'c'.repeat(64);
  const changedReceipt = { ...RECEIPT, authorityFingerprint: changedFp };
  await assert.rejects(
    () => readAndPersistWiserrGrowthSnapshot({
      store,
      receipt: changedReceipt,
      currentCommitSha: changedReceipt.validatedCommitSha,
      currentAuthorityFingerprint: changedFp,
      tenantId: 'tenant-1',
      dormantDays: 90,
      transport: transportFor(),
      now: NOW
    }),
    /DURABLE_WISERR_SNAPSHOT_CONFLICT/
  );
});

test('compact persistence event contains hashes/status but not cohort details', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await readAndPersistWiserrGrowthSnapshot({
    store,
    receipt: RECEIPT,
    currentCommitSha: RECEIPT.validatedCommitSha,
    currentAuthorityFingerprint: FP,
    tenantId: 'tenant-1',
    dormantDays: 90,
    transport: transportFor(),
    now: NOW
  });
  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: 'snapshot-1' });
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.capacityStatus, 'UNKNOWN');
  assert.equal(JSON.stringify(events[0]).includes('dormantCount'), false);
  assert.equal(JSON.stringify(events[0]).includes('eligibleByChannel'), false);
});

test('recovery validates stored snapshot hash and authority identity', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const saved = await readAndPersistWiserrGrowthSnapshot({
    store,
    receipt: RECEIPT,
    currentCommitSha: RECEIPT.validatedCommitSha,
    currentAuthorityFingerprint: FP,
    tenantId: 'tenant-1',
    dormantDays: 90,
    transport: transportFor(),
    now: NOW
  });
  const key = store.recordKey({ tenantId: 'tenant-1', recordType: 'wiserr_growth_snapshot', recordId: saved.record.recordId });
  store.records.get(key).payload.snapshot.reactivation.dormantCount = 999;
  await assert.rejects(
    () => loadDurableWiserrGrowthSnapshot({ store, tenantId: 'tenant-1', snapshotId: 'snapshot-1' }),
    /RUNTIME_RECORD_HASH_MISMATCH|DURABLE_WISERR_SNAPSHOT_HASH_MISMATCH/
  );
});
