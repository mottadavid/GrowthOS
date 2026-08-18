import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import {
  evaluateAndPersistCapacityBundle,
  loadDurableCapacityBundle,
  listDurableCapacityBundles,
  assertCapacityBundleUsableForDemand
} from '../src/runtime/capacity-bundle-repository.mjs';

const NOW = new Date('2026-08-18T20:00:00.000Z');
function authority(overrides = {}) { return {
  schemaVersion: 1, authorityId: 'auth-1', tenantId: 'tenant-1', sourceSystem: 'wiserr',
  sourceAuthority: 'wiserr://capacity/owner-attestation', status: 'ACTIVE',
  validFrom: '2026-08-18T19:00:00.000Z', validUntil: '2026-08-18T23:00:00.000Z',
  scopeKeys: ['tenant:tenant-1:service:all'], permissions: { canAssertAvailability: true, canAssertConstraints: true },
  evidenceRef: 'wiserr://authority/capacity/1', ...overrides
}; }
function evidence(overrides = {}) { return {
  schemaVersion: 1, evidenceId: 'evidence-1', tenantId: 'tenant-1', scopeKey: 'tenant:tenant-1:service:all',
  sourceSystem: 'wiserr', sourceAuthority: 'wiserr://capacity/owner-attestation', asOf: '2026-08-18T19:55:00.000Z',
  validUntil: '2026-08-18T21:00:00.000Z', completeness: 'COMPLETE_FOR_PURPOSE',
  signals: [{ signalId: 'available-1', verdict: 'AVAILABLE', authoritative: true, sourceRef: 'wiserr://capacity/attestation/1' }], ...overrides
}; }

test('authorized available evidence persists and is usable for demand', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const result = await evaluateAndPersistCapacityBundle({ store, evidence: evidence(), authority: authority(), now: NOW });
  assert.equal(result.authorityDecision.decision, 'READY');
  assert.equal(result.derived.status, 'AVAILABLE');
  assert.equal(assertCapacityBundleUsableForDemand(result.record, { now: NOW }).derived.status, 'AVAILABLE');
  const recovered = await loadDurableCapacityBundle({ store, tenantId: 'tenant-1', evidenceId: 'evidence-1', authorityId: 'auth-1' });
  assert.equal(recovered.payload.derived.status, 'AVAILABLE');
});

test('forged authoritative availability without permission persists as denied evidence but cannot unlock demand', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const result = await evaluateAndPersistCapacityBundle({
    store, evidence: evidence(), authority: authority({ permissions: { canAssertAvailability: false, canAssertConstraints: true } }), now: NOW
  });
  assert.equal(result.authorityDecision.decision, 'DENY');
  assert.equal(result.derived.status, 'UNKNOWN');
  assert.throws(() => assertCapacityBundleUsableForDemand(result.record, { now: NOW }), /DURABLE_CAPACITY_AUTHORITY_NOT_READY/);
});

test('same evidence/authority replay is idempotent but changed semantics conflict', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const first = await evaluateAndPersistCapacityBundle({ store, evidence: evidence(), authority: authority(), now: NOW });
  const second = await evaluateAndPersistCapacityBundle({ store, evidence: evidence(), authority: authority(), now: NOW });
  assert.equal(first.idempotent, false); assert.equal(second.idempotent, true);
  await assert.rejects(
    () => evaluateAndPersistCapacityBundle({ store, evidence: evidence({ signals: [{ signalId: 'full-1', verdict: 'FULL', authoritative: true, sourceRef: 'wiserr://capacity/full/1' }] }), authority: authority(), now: NOW }),
    /DURABLE_CAPACITY_BUNDLE_CONFLICT/
  );
});

test('expired authority/evidence stops a previously stored AVAILABLE bundle from being reused', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const result = await evaluateAndPersistCapacityBundle({ store, evidence: evidence(), authority: authority(), now: NOW });
  assert.throws(
    () => assertCapacityBundleUsableForDemand(result.record, { now: new Date('2026-08-19T00:00:00Z') }),
    /DURABLE_CAPACITY_AUTHORITY_NOT_READY/
  );
});

test('scope-index recovery is tenant/source/scope exact and compact events omit raw signals', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await evaluateAndPersistCapacityBundle({ store, evidence: evidence(), authority: authority(), now: NOW });
  const records = await listDurableCapacityBundles({ store, tenantId: 'tenant-1', sourceSystem: 'wiserr', sourceAuthority: 'wiserr://capacity/owner-attestation', scopeKey: 'tenant:tenant-1:service:all' });
  assert.equal(records.length, 1);
  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: 'evidence-1' });
  assert.equal(events.length, 1);
  assert.equal(JSON.stringify(events[0]).includes('sourceRef'), false);
  assert.equal(events[0].payload.derivedStatus, 'AVAILABLE');
});

test('corrupt recovery index fails closed', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const saved = await evaluateAndPersistCapacityBundle({ store, evidence: evidence(), authority: authority(), now: NOW });
  const key = store.recordKey({ tenantId: 'tenant-1', recordType: 'capacity_bundle', recordId: saved.record.recordId });
  store.records.get(key).indexKey = '0'.repeat(64);
  await assert.rejects(() => loadDurableCapacityBundle({ store, tenantId: 'tenant-1', evidenceId: 'evidence-1', authorityId: 'auth-1' }), /DURABLE_CAPACITY_BUNDLE_IDENTITY_MISMATCH/);
});
