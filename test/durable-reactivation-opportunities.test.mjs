import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import { readAndPersistWiserrGrowthSnapshot } from '../src/runtime/wiserr-snapshot-repository.mjs';
import { evaluateAndPersistCapacityBundle } from '../src/runtime/capacity-bundle-repository.mjs';
import {
  evaluateAndPersistDurableReactivationOpportunity,
  loadDurableReactivationOpportunityEvaluation,
  listDurableReactivationOpportunityEvaluations
} from '../src/runtime/reactivation-opportunity-repository.mjs';

const NOW = new Date('2026-08-18T20:00:00.000Z');
const RECEIPT = {
  schemaVersion: 1,
  dependencyId: 'wiserr-growth-snapshot-v1',
  system: 'WISERR_OS',
  repository: 'mottadavid/Wiserr-OS',
  contractName: 'wiserr-growth-snapshot',
  contractVersion: '1',
  status: 'CERTIFIED',
  validatedCommitSha: '1'.repeat(40),
  authorityFingerprint: 'a'.repeat(64),
  validatedAt: '2026-08-18T19:00:00.000Z',
  validUntil: null,
  guardedPaths: ['server/growth/growthSnapshotService.ts'],
  capabilities: { readGrowthSnapshot: true }
};

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    tenantId: 'tenant-1',
    generatedAt: '2026-08-18T19:59:00.000Z',
    completeness: 'PARTIAL',
    capacity: { status: 'UNKNOWN', demandThrottleRecommended: false },
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

function capacityAuthority(overrides = {}) {
  return {
    schemaVersion: 1,
    authorityId: 'capacity-auth-1',
    tenantId: 'tenant-1',
    sourceSystem: 'wiserr',
    sourceAuthority: 'wiserr://capacity/owner-attestation',
    status: 'ACTIVE',
    validFrom: '2026-08-18T19:00:00.000Z',
    validUntil: '2026-08-18T22:00:00.000Z',
    scopeKeys: ['tenant:tenant-1:service:all'],
    permissions: { canAssertAvailability: true, canAssertConstraints: true },
    evidenceRef: 'wiserr://authority/capacity/1',
    ...overrides
  };
}

function capacityEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    evidenceId: 'capacity-evidence-1',
    tenantId: 'tenant-1',
    scopeKey: 'tenant:tenant-1:service:all',
    sourceSystem: 'wiserr',
    sourceAuthority: 'wiserr://capacity/owner-attestation',
    asOf: '2026-08-18T19:58:00.000Z',
    validUntil: '2026-08-18T21:00:00.000Z',
    completeness: 'COMPLETE_FOR_PURPOSE',
    signals: [{ signalId: 'available-1', verdict: 'AVAILABLE', authoritative: true, sourceRef: 'wiserr://capacity/attestation/1' }],
    ...overrides
  };
}

async function seedSources(store, { snap = snapshot(), authority = capacityAuthority(), evidence = capacityEvidence() } = {}) {
  await readAndPersistWiserrGrowthSnapshot({
    store,
    receipt: RECEIPT,
    currentCommitSha: RECEIPT.validatedCommitSha,
    currentAuthorityFingerprint: RECEIPT.authorityFingerprint,
    tenantId: 'tenant-1',
    dormantDays: 90,
    transport: async () => structuredClone(snap),
    now: NOW
  });
  await evaluateAndPersistCapacityBundle({ store, evidence, authority, now: NOW });
}

test('opportunity is derived only from exact durable snapshot plus usable capacity bundle', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await seedSources(store);
  const result = await evaluateAndPersistDurableReactivationOpportunity({
    store,
    tenantId: 'tenant-1',
    snapshotId: 'snapshot-1',
    capacityEvidenceId: 'capacity-evidence-1',
    capacityAuthorityId: 'capacity-auth-1',
    now: NOW
  });
  assert.equal(result.result.decision, 'OPPORTUNITY');
  assert.equal(result.result.opportunity.businessSnapshotId, 'snapshot-1');
  assert.equal(result.record.indexKey, 'snapshot-1');
  assert.match(result.record.payload.capacityAuthorityHash, /^[0-9a-f]{64}$/);
});

test('same source evidence and detector policy replay idempotently', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await seedSources(store);
  const args = {
    store, tenantId: 'tenant-1', snapshotId: 'snapshot-1', capacityEvidenceId: 'capacity-evidence-1', capacityAuthorityId: 'capacity-auth-1', now: NOW
  };
  const first = await evaluateAndPersistDurableReactivationOpportunity(args);
  const second = await evaluateAndPersistDurableReactivationOpportunity(args);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.record.recordId, second.record.recordId);
});

test('different detector policy produces a separate evidence-bound evaluation', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await seedSources(store);
  const first = await evaluateAndPersistDurableReactivationOpportunity({
    store, tenantId: 'tenant-1', snapshotId: 'snapshot-1', capacityEvidenceId: 'capacity-evidence-1', capacityAuthorityId: 'capacity-auth-1', now: NOW
  });
  const second = await evaluateAndPersistDurableReactivationOpportunity({
    store, tenantId: 'tenant-1', snapshotId: 'snapshot-1', capacityEvidenceId: 'capacity-evidence-1', capacityAuthorityId: 'capacity-auth-1', options: { minDormantLeads: 200 }, now: NOW
  });
  assert.notEqual(first.record.recordId, second.record.recordId);
  assert.equal(second.result.decision, 'NO_ACTION');
});

test('expired capacity cannot reuse a previously detected opportunity as current evidence', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await seedSources(store);
  await evaluateAndPersistDurableReactivationOpportunity({
    store, tenantId: 'tenant-1', snapshotId: 'snapshot-1', capacityEvidenceId: 'capacity-evidence-1', capacityAuthorityId: 'capacity-auth-1', now: NOW
  });
  await assert.rejects(
    () => evaluateAndPersistDurableReactivationOpportunity({
      store, tenantId: 'tenant-1', snapshotId: 'snapshot-1', capacityEvidenceId: 'capacity-evidence-1', capacityAuthorityId: 'capacity-auth-1', now: new Date('2026-08-18T21:30:00Z'), maxSnapshotAgeMinutes: 120
    }),
    /DURABLE_CAPACITY_AUTHORITY_NOT_READY|DURABLE_CAPACITY_NOT_AVAILABLE/
  );
});

test('stale source snapshot refuses before opportunity evaluation', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await seedSources(store);
  await assert.rejects(
    () => evaluateAndPersistDurableReactivationOpportunity({
      store, tenantId: 'tenant-1', snapshotId: 'snapshot-1', capacityEvidenceId: 'capacity-evidence-1', capacityAuthorityId: 'capacity-auth-1', now: new Date('2026-08-18T20:30:00Z')
    }),
    /WISERR_GROWTH_SNAPSHOT_STALE/
  );
});

test('unusable capacity never manufactures an opportunity', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await seedSources(store, {
    authority: capacityAuthority({ permissions: { canAssertAvailability: false, canAssertConstraints: true } })
  });
  await assert.rejects(
    () => evaluateAndPersistDurableReactivationOpportunity({
      store, tenantId: 'tenant-1', snapshotId: 'snapshot-1', capacityEvidenceId: 'capacity-evidence-1', capacityAuthorityId: 'capacity-auth-1', now: NOW
    }),
    /DURABLE_CAPACITY_AUTHORITY_NOT_READY/
  );
});

test('snapshot-scoped recovery preserves exact source hashes and compact evidence', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await seedSources(store);
  const saved = await evaluateAndPersistDurableReactivationOpportunity({
    store, tenantId: 'tenant-1', snapshotId: 'snapshot-1', capacityEvidenceId: 'capacity-evidence-1', capacityAuthorityId: 'capacity-auth-1', now: NOW
  });
  const records = await listDurableReactivationOpportunityEvaluations({ store, tenantId: 'tenant-1', snapshotId: 'snapshot-1' });
  assert.equal(records.length, 1);
  const loaded = await loadDurableReactivationOpportunityEvaluation({ store, tenantId: 'tenant-1', evaluationId: saved.record.recordId });
  assert.equal(loaded.payload.snapshotHash, saved.record.payload.snapshotHash);
  assert.equal(loaded.payload.capacitySemanticHash, saved.record.payload.capacitySemanticHash);

  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: saved.result.opportunity.opportunityId });
  assert.equal(events.length, 1);
  assert.equal(JSON.stringify(events[0]).includes('expectedImpact'), false);
  assert.equal(events[0].payload.decision, 'OPPORTUNITY');
});
