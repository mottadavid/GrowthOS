import { sha256Canonical } from '../core/canonical.mjs';
import { validateCapacityEvidence } from '../core/capacity-evidence.mjs';
import {
  validateCapacitySourceAuthority,
  evaluateCapacitySourceAuthority,
  deriveCapacityStateWithAuthority,
  capacitySourceAuthorityHash,
  CAPACITY_AUTHORITY_DECISIONS
} from '../core/capacity-source-authority.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const CAPACITY_BUNDLE_RECORD_TYPE = 'capacity_bundle';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function clone(value) { return structuredClone(value); }

export function capacityBundleId({ tenantId, evidenceId, authorityId }) {
  return `capacity-${sha256Canonical({
    tenantId: requiredString(tenantId, 'tenantId'),
    evidenceId: requiredString(evidenceId, 'evidenceId'),
    authorityId: requiredString(authorityId, 'authorityId')
  })}`;
}

function semanticBody({ evidence, authority, derived }) {
  return { evidence: clone(evidence), authority: clone(authority), derived: clone(derived) };
}

function validateBundleRecord(record, tenantId) {
  const payload = record?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('capacity bundle payload must be an object.');
  if (payload.schemaVersion !== 1) throw new Error('Unsupported capacity bundle schemaVersion.');
  validateCapacityEvidence(payload.evidence);
  validateCapacitySourceAuthority(payload.authority);
  if (!payload.derived || typeof payload.derived !== 'object') throw new Error('payload.derived is required.');
  if (!/^[0-9a-f]{64}$/.test(payload.semanticHash || '')) throw new Error('payload.semanticHash must be SHA-256 hex.');
  const expectedId = capacityBundleId({ tenantId: payload.evidence.tenantId, evidenceId: payload.evidence.evidenceId, authorityId: payload.authority.authorityId });
  const expectedIndex = sha256Canonical({ sourceSystem: payload.evidence.sourceSystem, sourceAuthority: payload.evidence.sourceAuthority, scopeKey: payload.evidence.scopeKey });
  if (sha256Canonical(semanticBody(payload)) !== payload.semanticHash) throw new Error('DURABLE_CAPACITY_BUNDLE_SEMANTIC_HASH_MISMATCH');
  if (record.tenantId !== tenantId || payload.evidence.tenantId !== tenantId || payload.authority.tenantId !== tenantId || record.recordId !== expectedId || record.indexKey !== expectedIndex) {
    throw new Error('DURABLE_CAPACITY_BUNDLE_IDENTITY_MISMATCH');
  }
  return record;
}

export function capacityBundleRecoveryIndex({ sourceSystem, sourceAuthority, scopeKey }) {
  return sha256Canonical({
    sourceSystem: requiredString(sourceSystem, 'sourceSystem'),
    sourceAuthority: requiredString(sourceAuthority, 'sourceAuthority'),
    scopeKey: requiredString(scopeKey, 'scopeKey')
  });
}

export async function loadDurableCapacityBundle({ store, tenantId, evidenceId, authorityId }) {
  const recordId = capacityBundleId({ tenantId, evidenceId, authorityId });
  const record = await store.getRecord({ tenantId, recordType: CAPACITY_BUNDLE_RECORD_TYPE, recordId });
  if (!record) return null;
  return validateBundleRecord(record, tenantId);
}

export async function listDurableCapacityBundles({ store, tenantId, sourceSystem, sourceAuthority, scopeKey, limit = 1000 }) {
  requiredString(tenantId, 'tenantId');
  const indexKey = capacityBundleRecoveryIndex({ sourceSystem, sourceAuthority, scopeKey });
  const records = await store.listRecords({ tenantId, recordType: CAPACITY_BUNDLE_RECORD_TYPE, indexKey, limit });
  return records.map(record => validateBundleRecord(record, tenantId));
}

export async function evaluateAndPersistCapacityBundle({ store, evidence, authority, now = new Date() }) {
  validateCapacityEvidence(evidence);
  validateCapacitySourceAuthority(authority);
  const authorityDecision = evaluateCapacitySourceAuthority({ evidence, authority, now });
  const derived = deriveCapacityStateWithAuthority({ evidence, authority, now });
  const recordId = capacityBundleId({ tenantId: evidence.tenantId, evidenceId: evidence.evidenceId, authorityId: authority.authorityId });
  const indexKey = capacityBundleRecoveryIndex({ sourceSystem: evidence.sourceSystem, sourceAuthority: evidence.sourceAuthority, scopeKey: evidence.scopeKey });
  const body = semanticBody({ evidence, authority, derived });
  const payload = { schemaVersion: 1, ...body, semanticHash: sha256Canonical(body) };

  const existing = await loadDurableCapacityBundle({ store, tenantId: evidence.tenantId, evidenceId: evidence.evidenceId, authorityId: authority.authorityId });
  if (existing) {
    if (existing.payload.semanticHash !== payload.semanticHash) throw new Error('DURABLE_CAPACITY_BUNDLE_CONFLICT');
    return { record: existing, authorityDecision, derived, idempotent: true };
  }

  const result = await mutateAuthoritativeRuntimeState({
    store,
    tenantId: evidence.tenantId,
    recordType: CAPACITY_BUNDLE_RECORD_TYPE,
    recordId,
    indexKey,
    payload,
    expectedRevision: 0,
    now,
    event: {
      eventId: `capacity-bundle:${recordId}`,
      eventType: 'growth.capacity_evidence.persisted',
      payload: {
        recordId,
        evidenceId: evidence.evidenceId,
        authorityId: authority.authorityId,
        authorityDecision: authorityDecision.decision,
        derivedStatus: derived.status,
        demandThrottleRecommended: derived.demandThrottleRecommended,
        semanticHash: payload.semanticHash,
        scopeKey: evidence.scopeKey
      },
      correlationId: evidence.evidenceId
    }
  });
  return { record: validateBundleRecord(result.record, evidence.tenantId), authorityDecision, derived, idempotent: false };
}

export function assertCapacityBundleUsableForDemand(record, { now = new Date() } = {}) {
  validateBundleRecord(record, record.tenantId);
  const { evidence, authority } = record.payload;
  const decision = evaluateCapacitySourceAuthority({ evidence, authority, now });
  const derived = deriveCapacityStateWithAuthority({ evidence, authority, now });
  if (decision.decision !== CAPACITY_AUTHORITY_DECISIONS.READY) throw new Error(`DURABLE_CAPACITY_AUTHORITY_NOT_READY:${decision.reasons.join(',')}`);
  if (derived.status !== 'AVAILABLE' || derived.demandThrottleRecommended === true) throw new Error(`DURABLE_CAPACITY_NOT_AVAILABLE:${derived.status}`);
  return { authorityDecision: decision, derived };
}

export function capacityExecutionProofHash(proof) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) throw new Error('capacity proof must be an object.');
  const { proofHash, ...body } = proof;
  return sha256Canonical(body);
}

export function buildCapacityExecutionProof(record, { now = new Date() } = {}) {
  validateBundleRecord(record, record.tenantId);
  const usable = assertCapacityBundleUsableForDemand(record, { now });
  const { evidence, authority, semanticHash } = record.payload;
  const proof = {
    schemaVersion: 1,
    tenantId: record.tenantId,
    capacityBundleId: record.recordId,
    capacitySemanticHash: semanticHash,
    evidenceId: evidence.evidenceId,
    authorityId: authority.authorityId,
    authorityHash: capacitySourceAuthorityHash(authority),
    sourceSystem: evidence.sourceSystem,
    sourceAuthority: evidence.sourceAuthority,
    scopeKey: evidence.scopeKey,
    asOf: evidence.asOf,
    validUntil: evidence.validUntil,
    derivedStatus: usable.derived.status,
    demandThrottleRecommended: usable.derived.demandThrottleRecommended,
    authorityDecision: usable.authorityDecision.decision
  };
  return { ...proof, proofHash: sha256Canonical(proof) };
}

export function validateCapacityExecutionProof(proof, { tenantId = null, now = new Date() } = {}) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) throw new Error('capacity proof must be an object.');
  if (proof.schemaVersion !== 1) throw new Error('Unsupported capacity proof schemaVersion.');
  for (const field of ['tenantId','capacityBundleId','capacitySemanticHash','evidenceId','authorityId','authorityHash','sourceSystem','sourceAuthority','scopeKey','asOf','validUntil','derivedStatus','authorityDecision','proofHash']) {
    requiredString(proof[field], `capacityProof.${field}`);
  }
  for (const field of ['capacitySemanticHash','authorityHash','proofHash']) {
    if (!/^[0-9a-f]{64}$/.test(proof[field])) throw new Error(`capacityProof.${field} must be SHA-256 hex.`);
  }
  if (capacityExecutionProofHash(proof) !== proof.proofHash) throw new Error('CAPACITY_EXECUTION_PROOF_HASH_MISMATCH');
  if (tenantId !== null && proof.tenantId !== tenantId) throw new Error('CAPACITY_EXECUTION_PROOF_TENANT_MISMATCH');
  if (proof.derivedStatus !== 'AVAILABLE' || proof.demandThrottleRecommended !== false || proof.authorityDecision !== CAPACITY_AUTHORITY_DECISIONS.READY) {
    throw new Error('CAPACITY_EXECUTION_PROOF_NOT_AVAILABLE');
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('now must be a valid date/time.');
  if (!Number.isFinite(Date.parse(proof.asOf)) || !Number.isFinite(Date.parse(proof.validUntil))) throw new Error('capacity proof dates must be valid.');
  if (nowMs > Date.parse(proof.validUntil)) throw new Error('CAPACITY_EXECUTION_PROOF_EXPIRED');
  return proof;
}
