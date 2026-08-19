import { sha256Canonical } from './canonical.mjs';
import { CAPACITY_AUTHORITY_DECISIONS } from './capacity-source-authority.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

export function capacityExecutionProofHash(proof) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) throw new Error('capacity proof must be an object.');
  const { proofHash, ...body } = proof;
  return sha256Canonical(body);
}

export function validateCapacityExecutionProof(proof, { tenantId = null, now = new Date() } = {}) {
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) throw new Error('capacity proof must be an object.');
  if (proof.schemaVersion !== 1) throw new Error('Unsupported capacity proof schemaVersion.');
  for (const field of ['tenantId','capacityBundleId','capacitySemanticHash','evidenceId','authorityId','authorityHash','sourceSystem','sourceAuthority','scopeKey','asOf','validUntil','derivedStatus','authorityDecision','proofHash']) {
    requiredString(proof[field], `capacityProof.${field}`);
  }
  if (typeof proof.demandThrottleRecommended !== 'boolean') throw new Error('capacityProof.demandThrottleRecommended must be boolean.');
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
  if (nowMs < Date.parse(proof.asOf)) throw new Error('CAPACITY_EXECUTION_PROOF_NOT_YET_VALID');
  if (nowMs > Date.parse(proof.validUntil)) throw new Error('CAPACITY_EXECUTION_PROOF_EXPIRED');
  return proof;
}
