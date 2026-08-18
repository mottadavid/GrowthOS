import { sha256Canonical } from '../core/canonical.mjs';
import { readWiserrGrowthSnapshot } from '../integrations/wiserr/read-client.mjs';
import { validateWiserrGrowthSnapshot } from '../integrations/wiserr/growth-snapshot.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const WISERR_GROWTH_SNAPSHOT_RECORD_TYPE = 'wiserr_growth_snapshot';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function validateSha(value, label, length) {
  if (!new RegExp(`^[0-9a-f]{${length}}$`).test(value || '')) throw new Error(`${label} must be ${length}-character lowercase hex.`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function validateReadAuthority(authority) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) throw new Error('read authority proof must be an object.');
  requiredString(authority.dependencyId, 'authority.dependencyId');
  validateSha(authority.validatedCommitSha, 'authority.validatedCommitSha', 40);
  validateSha(authority.currentCommitSha, 'authority.currentCommitSha', 40);
  validateSha(authority.authorityFingerprint, 'authority.authorityFingerprint', 64);
  validateSha(authority.lockFingerprint, 'authority.lockFingerprint', 64);
  return authority;
}

function validateSnapshotRecord(record, tenantId) {
  const payload = record?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Wiserr snapshot payload must be an object.');
  if (payload.schemaVersion !== 1) throw new Error('Unsupported Wiserr snapshot payload schemaVersion.');
  if (payload.sourceSystem !== 'WISERR_OS') throw new Error('Invalid Wiserr snapshot sourceSystem.');
  validateWiserrGrowthSnapshot(payload.snapshot);
  validateReadAuthority(payload.authority);
  if (!/^[0-9a-f]{64}$/.test(payload.snapshotHash || '')) throw new Error('payload.snapshotHash must be SHA-256 hex.');
  if (sha256Canonical(payload.snapshot) !== payload.snapshotHash) throw new Error('DURABLE_WISERR_SNAPSHOT_HASH_MISMATCH');
  if (
    record.tenantId !== tenantId ||
    payload.snapshot.tenantId !== tenantId ||
    record.recordId !== payload.snapshot.snapshotId ||
    record.indexKey !== payload.authority.dependencyId
  ) {
    throw new Error('DURABLE_WISERR_SNAPSHOT_IDENTITY_MISMATCH');
  }
  return record;
}

export async function loadDurableWiserrGrowthSnapshot({ store, tenantId, snapshotId }) {
  requiredString(tenantId, 'tenantId');
  requiredString(snapshotId, 'snapshotId');
  const record = await store.getRecord({
    tenantId,
    recordType: WISERR_GROWTH_SNAPSHOT_RECORD_TYPE,
    recordId: snapshotId
  });
  if (!record) return null;
  return validateSnapshotRecord(record, tenantId);
}

export async function listDurableWiserrGrowthSnapshots({ store, tenantId, dependencyId, limit = 1000 }) {
  requiredString(tenantId, 'tenantId');
  requiredString(dependencyId, 'dependencyId');
  const records = await store.listRecords({
    tenantId,
    recordType: WISERR_GROWTH_SNAPSHOT_RECORD_TYPE,
    indexKey: dependencyId,
    limit
  });
  return records.map(record => validateSnapshotRecord(record, tenantId));
}

export async function readAndPersistWiserrGrowthSnapshot({
  store,
  receipt,
  currentCommitSha,
  currentAuthorityFingerprint = null,
  tenantId,
  dormantDays,
  transport,
  now = new Date(),
  maxAgeMinutes = 15,
  maxFutureSkewMinutes = 2
}) {
  const readResult = await readWiserrGrowthSnapshot({
    receipt,
    currentCommitSha,
    currentAuthorityFingerprint,
    tenantId,
    dormantDays,
    transport,
    now,
    maxAgeMinutes,
    maxFutureSkewMinutes
  });
  validateWiserrGrowthSnapshot(readResult.snapshot);
  validateReadAuthority(readResult.authority);

  const snapshotHash = sha256Canonical(readResult.snapshot);
  const existing = await loadDurableWiserrGrowthSnapshot({
    store,
    tenantId,
    snapshotId: readResult.snapshot.snapshotId
  });
  if (existing) {
    const sameSemanticAuthority =
      existing.payload.authority.dependencyId === readResult.authority.dependencyId &&
      existing.payload.authority.authorityFingerprint === readResult.authority.authorityFingerprint &&
      existing.payload.authority.lockFingerprint === readResult.authority.lockFingerprint;
    if (existing.payload.snapshotHash !== snapshotHash || !sameSemanticAuthority) {
      throw new Error('DURABLE_WISERR_SNAPSHOT_CONFLICT');
    }
    return { record: existing, readResult, idempotent: true };
  }

  const payload = {
    schemaVersion: 1,
    sourceSystem: 'WISERR_OS',
    snapshot: clone(readResult.snapshot),
    snapshotHash,
    authority: clone(readResult.authority)
  };

  const result = await mutateAuthoritativeRuntimeState({
    store,
    tenantId,
    recordType: WISERR_GROWTH_SNAPSHOT_RECORD_TYPE,
    recordId: readResult.snapshot.snapshotId,
    indexKey: readResult.authority.dependencyId,
    payload,
    expectedRevision: 0,
    now,
    event: {
      eventId: `wiserr-growth-snapshot:${readResult.snapshot.snapshotId}`,
      eventType: 'growth.business_snapshot.persisted',
      payload: {
        snapshotId: readResult.snapshot.snapshotId,
        snapshotHash,
        dependencyId: readResult.authority.dependencyId,
        authorityFingerprint: readResult.authority.authorityFingerprint,
        lockFingerprint: readResult.authority.lockFingerprint,
        generatedAt: readResult.snapshot.generatedAt,
        completeness: readResult.snapshot.completeness,
        capacityStatus: readResult.snapshot.capacity.status
      },
      correlationId: readResult.snapshot.snapshotId
    }
  });

  return {
    record: validateSnapshotRecord(result.record, tenantId),
    readResult,
    idempotent: false
  };
}
