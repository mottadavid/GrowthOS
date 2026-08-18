import { evaluateUpstreamAuthority, UPSTREAM_AUTHORITY_DECISIONS } from '../../core/upstream-authority.mjs';
import { validateWiserrGrowthSnapshot } from './growth-snapshot.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function validNow(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('now must be a valid date/time.');
  return date;
}

export function evaluateWiserrGrowthSnapshotReadAuthority({
  receipt,
  currentCommitSha,
  currentAuthorityFingerprint = null,
  now = new Date()
}) {
  return evaluateUpstreamAuthority({
    receipt,
    currentCommitSha,
    currentAuthorityFingerprint,
    requiredCapabilities: ['readGrowthSnapshot'],
    now
  });
}

export function validateGrowthSnapshotFreshness(snapshot, {
  now = new Date(),
  maxAgeMinutes = 15,
  maxFutureSkewMinutes = 2
} = {}) {
  validateWiserrGrowthSnapshot(snapshot);
  positiveInteger(maxAgeMinutes, 'maxAgeMinutes');
  if (!Number.isInteger(maxFutureSkewMinutes) || maxFutureSkewMinutes < 0) {
    throw new Error('maxFutureSkewMinutes must be a non-negative integer.');
  }

  const current = validNow(now);
  const generatedAt = new Date(snapshot.generatedAt);
  const ageMs = current.getTime() - generatedAt.getTime();
  const maxAgeMs = maxAgeMinutes * 60_000;
  const maxFutureSkewMs = maxFutureSkewMinutes * 60_000;

  if (ageMs < -maxFutureSkewMs) throw new Error('WISERR_GROWTH_SNAPSHOT_FROM_FUTURE');
  if (ageMs > maxAgeMs) throw new Error('WISERR_GROWTH_SNAPSHOT_STALE');
  return snapshot;
}

export async function readWiserrGrowthSnapshot({
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
  requiredString(tenantId, 'tenantId');
  positiveInteger(dormantDays, 'dormantDays');
  if (typeof transport !== 'function') throw new Error('transport must be a function.');

  const authority = evaluateWiserrGrowthSnapshotReadAuthority({
    receipt,
    currentCommitSha,
    currentAuthorityFingerprint,
    now
  });

  if (authority.decision !== UPSTREAM_AUTHORITY_DECISIONS.READY) {
    const error = new Error(`WISERR_GROWTH_SNAPSHOT_READ_NOT_CERTIFIED:${authority.reasons.join(',')}`);
    error.authorityDecision = authority;
    throw error;
  }

  const snapshot = await transport({ tenantId, dormantDays });
  validateWiserrGrowthSnapshot(snapshot);

  if (snapshot.tenantId !== tenantId) throw new Error('WISERR_GROWTH_SNAPSHOT_TENANT_MISMATCH');
  validateGrowthSnapshotFreshness(snapshot, { now, maxAgeMinutes, maxFutureSkewMinutes });

  return {
    snapshot,
    authority: {
      dependencyId: receipt.dependencyId,
      validatedCommitSha: receipt.validatedCommitSha,
      currentCommitSha,
      authorityFingerprint: receipt.authorityFingerprint,
      lockFingerprint: authority.metadata.lockFingerprint
    }
  };
}
