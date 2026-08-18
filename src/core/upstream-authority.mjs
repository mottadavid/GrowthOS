import { sha256Canonical } from './canonical.mjs';

export const UPSTREAM_AUTHORITY_STATES = Object.freeze([
  'OBSERVED',
  'CANDIDATE',
  'CERTIFIED',
  'REVOKED'
]);

export const UPSTREAM_AUTHORITY_DECISIONS = Object.freeze({
  READY: 'READY',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  DENY: 'DENY'
});

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function validDate(value, label, nullable = false) {
  if (value === null && nullable) return null;
  requiredString(value, label);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label} must be a valid date-time.`);
  return ms;
}

export function validateUpstreamAuthorityReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('receipt must be an object.');
  if (receipt.schemaVersion !== 1) throw new Error('Unsupported receipt schemaVersion.');
  requiredString(receipt.dependencyId, 'receipt.dependencyId');
  requiredString(receipt.repository, 'receipt.repository');
  requiredString(receipt.contractName, 'receipt.contractName');
  requiredString(receipt.contractVersion, 'receipt.contractVersion');
  if (!UPSTREAM_AUTHORITY_STATES.includes(receipt.status)) throw new Error('Invalid receipt.status.');
  if (!/^[0-9a-f]{40}$/.test(receipt.validatedCommitSha || '')) throw new Error('receipt.validatedCommitSha must be a 40-character lowercase SHA.');
  if (!/^[0-9a-f]{64}$/.test(receipt.authorityFingerprint || '')) throw new Error('receipt.authorityFingerprint must be a SHA-256 hex digest.');
  validDate(receipt.validatedAt, 'receipt.validatedAt');
  if (receipt.validUntil !== undefined) validDate(receipt.validUntil, 'receipt.validUntil', true);
  if (!Array.isArray(receipt.guardedPaths) || receipt.guardedPaths.length === 0 || receipt.guardedPaths.some(path => typeof path !== 'string' || !path.trim())) {
    throw new Error('receipt.guardedPaths must contain at least one non-empty path.');
  }
  if (!receipt.capabilities || typeof receipt.capabilities !== 'object' || Array.isArray(receipt.capabilities)) throw new Error('receipt.capabilities must be an object.');
  for (const [key, value] of Object.entries(receipt.capabilities)) {
    requiredString(key, 'capability key');
    if (typeof value !== 'boolean') throw new Error(`receipt.capabilities.${key} must be boolean.`);
  }
  return receipt;
}

export function upstreamAuthorityLockFingerprint(receipt, requiredCapabilities = []) {
  validateUpstreamAuthorityReceipt(receipt);
  return sha256Canonical({
    dependencyId: receipt.dependencyId,
    repository: receipt.repository,
    contractName: receipt.contractName,
    contractVersion: receipt.contractVersion,
    authorityFingerprint: receipt.authorityFingerprint,
    requiredCapabilities: [...requiredCapabilities].sort()
  });
}

export function evaluateUpstreamAuthority({
  receipt,
  currentCommitSha,
  currentAuthorityFingerprint = null,
  requiredCapabilities = [],
  now = new Date()
}) {
  validateUpstreamAuthorityReceipt(receipt);
  if (!/^[0-9a-f]{40}$/.test(currentCommitSha || '')) throw new Error('currentCommitSha must be a 40-character lowercase SHA.');
  if (currentAuthorityFingerprint !== null && !/^[0-9a-f]{64}$/.test(currentAuthorityFingerprint)) {
    throw new Error('currentAuthorityFingerprint must be null or a SHA-256 hex digest.');
  }
  if (!Array.isArray(requiredCapabilities) || requiredCapabilities.some(capability => typeof capability !== 'string' || !capability.trim())) {
    throw new Error('requiredCapabilities must be an array of non-empty strings.');
  }

  const reasons = [];
  const metadata = {
    dependencyId: receipt.dependencyId,
    validatedCommitSha: receipt.validatedCommitSha,
    currentCommitSha,
    lockFingerprint: upstreamAuthorityLockFingerprint(receipt, requiredCapabilities)
  };

  if (receipt.status === 'REVOKED') {
    return { decision: UPSTREAM_AUTHORITY_DECISIONS.DENY, reasons: ['UPSTREAM_AUTHORITY_REVOKED'], metadata };
  }

  for (const capability of requiredCapabilities) {
    if (receipt.capabilities[capability] !== true) reasons.push(`CAPABILITY_NOT_CERTIFIED:${capability}`);
  }
  if (reasons.length) {
    return { decision: UPSTREAM_AUTHORITY_DECISIONS.DENY, reasons, metadata };
  }

  if (receipt.status !== 'CERTIFIED') {
    return {
      decision: UPSTREAM_AUTHORITY_DECISIONS.REVIEW_REQUIRED,
      reasons: [`UPSTREAM_AUTHORITY_${receipt.status}`],
      metadata
    };
  }

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('now must be a valid date/time.');
  if (receipt.validUntil && nowMs > Date.parse(receipt.validUntil)) {
    return { decision: UPSTREAM_AUTHORITY_DECISIONS.REVIEW_REQUIRED, reasons: ['UPSTREAM_AUTHORITY_EXPIRED'], metadata };
  }

  if (currentCommitSha !== receipt.validatedCommitSha) {
    if (currentAuthorityFingerprint === null) {
      return {
        decision: UPSTREAM_AUTHORITY_DECISIONS.REVIEW_REQUIRED,
        reasons: ['UPSTREAM_MOVED_FINGERPRINT_UNVERIFIED'],
        metadata
      };
    }
    if (currentAuthorityFingerprint !== receipt.authorityFingerprint) {
      return {
        decision: UPSTREAM_AUTHORITY_DECISIONS.REVIEW_REQUIRED,
        reasons: ['UPSTREAM_AUTHORITY_CHANGED'],
        metadata
      };
    }
  } else if (currentAuthorityFingerprint !== null && currentAuthorityFingerprint !== receipt.authorityFingerprint) {
    return {
      decision: UPSTREAM_AUTHORITY_DECISIONS.REVIEW_REQUIRED,
      reasons: ['UPSTREAM_AUTHORITY_FINGERPRINT_MISMATCH'],
      metadata
    };
  }

  return {
    decision: UPSTREAM_AUTHORITY_DECISIONS.READY,
    reasons: ['UPSTREAM_AUTHORITY_CERTIFIED'],
    metadata
  };
}
