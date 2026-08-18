import { sha256Canonical } from './canonical.mjs';
import { deriveCapacityState, validateCapacityEvidence } from './capacity-evidence.mjs';

export const CAPACITY_AUTHORITY_STATES = Object.freeze(['ACTIVE', 'REVOKED', 'EXPIRED']);
export const CAPACITY_AUTHORITY_DECISIONS = Object.freeze({
  READY: 'READY',
  DENY: 'DENY'
});

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function dateMs(value, label) {
  requiredString(value, label);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label} must be a valid date-time.`);
  return ms;
}

function uniqueStrings(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must contain at least one value.`);
  const normalized = value.map((item) => requiredString(item, `${label} item`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates.`);
  return normalized;
}

export function validateCapacitySourceAuthority(authority) {
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) throw new Error('authority must be an object.');
  if (authority.schemaVersion !== 1) throw new Error('Unsupported authority.schemaVersion.');
  requiredString(authority.authorityId, 'authority.authorityId');
  requiredString(authority.tenantId, 'authority.tenantId');
  requiredString(authority.sourceSystem, 'authority.sourceSystem');
  requiredString(authority.sourceAuthority, 'authority.sourceAuthority');
  if (!CAPACITY_AUTHORITY_STATES.includes(authority.status)) throw new Error('Invalid authority.status.');
  const validFrom = dateMs(authority.validFrom, 'authority.validFrom');
  const validUntil = dateMs(authority.validUntil, 'authority.validUntil');
  if (validUntil <= validFrom) throw new Error('authority.validUntil must be after validFrom.');
  uniqueStrings(authority.scopeKeys, 'authority.scopeKeys');
  if (!authority.permissions || typeof authority.permissions !== 'object' || Array.isArray(authority.permissions)) {
    throw new Error('authority.permissions is required.');
  }
  for (const key of ['canAssertAvailability', 'canAssertConstraints']) {
    if (typeof authority.permissions[key] !== 'boolean') throw new Error(`authority.permissions.${key} must be boolean.`);
  }
  requiredString(authority.evidenceRef, 'authority.evidenceRef');
  return authority;
}

export function capacitySourceAuthorityHash(authority) {
  validateCapacitySourceAuthority(authority);
  return sha256Canonical({
    schemaVersion: authority.schemaVersion,
    authorityId: authority.authorityId,
    tenantId: authority.tenantId,
    sourceSystem: authority.sourceSystem,
    sourceAuthority: authority.sourceAuthority,
    status: authority.status,
    validFrom: authority.validFrom,
    validUntil: authority.validUntil,
    scopeKeys: [...authority.scopeKeys].sort(),
    permissions: authority.permissions,
    evidenceRef: authority.evidenceRef
  });
}

export function evaluateCapacitySourceAuthority({ evidence, authority, now = new Date() }) {
  validateCapacityEvidence(evidence);
  validateCapacitySourceAuthority(authority);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('now must be a valid date/time.');

  const reasons = [];
  if (authority.status !== 'ACTIVE') reasons.push(`CAPACITY_AUTHORITY_${authority.status}`);
  if (nowMs < Date.parse(authority.validFrom) || nowMs > Date.parse(authority.validUntil)) reasons.push('CAPACITY_AUTHORITY_NOT_CURRENT');
  if (evidence.tenantId !== authority.tenantId) reasons.push('CAPACITY_AUTHORITY_TENANT_MISMATCH');
  if (evidence.sourceSystem !== authority.sourceSystem) reasons.push('CAPACITY_AUTHORITY_SOURCE_SYSTEM_MISMATCH');
  if (evidence.sourceAuthority !== authority.sourceAuthority) reasons.push('CAPACITY_AUTHORITY_SOURCE_MISMATCH');
  if (!authority.scopeKeys.includes(evidence.scopeKey)) reasons.push('CAPACITY_AUTHORITY_SCOPE_MISMATCH');

  const evidenceAsOf = Date.parse(evidence.asOf);
  if (evidenceAsOf < Date.parse(authority.validFrom) || evidenceAsOf > Date.parse(authority.validUntil)) {
    reasons.push('CAPACITY_EVIDENCE_OUTSIDE_AUTHORITY_WINDOW');
  }
  if (evidence.validUntil && Date.parse(evidence.validUntil) > Date.parse(authority.validUntil)) {
    reasons.push('CAPACITY_EVIDENCE_VALIDITY_EXCEEDS_AUTHORITY');
  }

  for (const signal of evidence.signals) {
    if (signal.authoritative !== true) continue;
    if (signal.verdict === 'AVAILABLE' && authority.permissions.canAssertAvailability !== true) {
      reasons.push(`CAPACITY_SIGNAL_NOT_AUTHORIZED:${signal.signalId}:AVAILABLE`);
    }
    if (['CONSTRAINED', 'FULL'].includes(signal.verdict) && authority.permissions.canAssertConstraints !== true) {
      reasons.push(`CAPACITY_SIGNAL_NOT_AUTHORIZED:${signal.signalId}:${signal.verdict}`);
    }
  }

  return {
    decision: reasons.length ? CAPACITY_AUTHORITY_DECISIONS.DENY : CAPACITY_AUTHORITY_DECISIONS.READY,
    reasons: reasons.length ? [...new Set(reasons)] : ['CAPACITY_SOURCE_AUTHORITY_READY'],
    authorityId: authority.authorityId,
    authorityHash: capacitySourceAuthorityHash(authority)
  };
}

export function deriveCapacityStateWithAuthority({ evidence, authority, now = new Date() }) {
  const authorityDecision = evaluateCapacitySourceAuthority({ evidence, authority, now });
  if (authorityDecision.decision !== CAPACITY_AUTHORITY_DECISIONS.READY) {
    return {
      status: 'UNKNOWN',
      demandThrottleRecommended: true,
      reasons: ['CAPACITY_SOURCE_AUTHORITY_DENIED', ...authorityDecision.reasons],
      evidenceId: evidence.evidenceId,
      scopeKey: evidence.scopeKey,
      authorityId: authority.authorityId,
      authorityHash: authorityDecision.authorityHash
    };
  }

  const derived = deriveCapacityState(evidence, { now });
  return {
    ...derived,
    authorityId: authority.authorityId,
    authorityHash: authorityDecision.authorityHash
  };
}
