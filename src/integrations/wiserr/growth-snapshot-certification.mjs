import {
  candidateWiserrGrowthSnapshotMountedBasis,
  validateWiserrGrowthSnapshotAuthorityBasis,
  wiserrGrowthSnapshotAuthorityFingerprint
} from './growth-snapshot-authority.mjs';
import { validateUpstreamAuthorityReceipt } from '../../core/upstream-authority.mjs';

export const WISERR_GROWTH_SNAPSHOT_DEPENDENCY_ID = 'wiserr-growth-snapshot-v1';
export const WISERR_GROWTH_SNAPSHOT_REQUIRED_GATES = Object.freeze([
  'Tests Gate',
  'Documentation Governance',
  'Agent Authority Audit',
  'gitleaks',
  'Timeline Real-Store Gate',
  'Chat Analytics QA',
  'Quality Gate'
]);

export const WISERR_GROWTH_SNAPSHOT_CERTIFICATION_DECISIONS = Object.freeze({
  CERTIFIABLE: 'CERTIFIABLE',
  BLOCKED: 'BLOCKED'
});

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function assertSha(value, label) {
  requiredString(value, label);
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`${label} must be a 40-character lowercase SHA.`);
  return value;
}

function assertSha256(value, label) {
  requiredString(value, label);
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error(`${label} must be a SHA-256 hex digest.`);
  return value;
}

function dateIso(value, label) {
  requiredString(value, label);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label} must be a valid date-time.`);
  return new Date(ms).toISOString();
}

function exactStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function normalizedGateResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    conclusion: typeof value.conclusion === 'string' ? value.conclusion.toLowerCase() : null,
    headSha: typeof value.headSha === 'string' ? value.headSha : null
  };
}

export function evaluateWiserrMountedSnapshotCertification({ evidence, mountedBasis = candidateWiserrGrowthSnapshotMountedBasis() }) {
  validateWiserrGrowthSnapshotAuthorityBasis(mountedBasis);
  if (!mountedBasis.readSurface.mounted || mountedBasis.capabilities.readGrowthSnapshot !== true) {
    throw new Error('mountedBasis must represent a mounted readGrowthSnapshot surface.');
  }
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('evidence must be an object.');

  const expectedFingerprint = wiserrGrowthSnapshotAuthorityFingerprint(mountedBasis);
  const reasons = [];

  if (evidence.repository !== 'mottadavid/Wiserr-OS') reasons.push('UNEXPECTED_REPOSITORY');
  if (evidence.routeMerged !== true) reasons.push('ROUTE_NOT_MERGED');

  const routePrHeadSha = assertSha(evidence.routePrHeadSha, 'evidence.routePrHeadSha');
  const mergedRouteCommitSha = assertSha(evidence.mergedRouteCommitSha, 'evidence.mergedRouteCommitSha');
  const currentCommitSha = assertSha(evidence.currentCommitSha, 'evidence.currentCommitSha');
  const currentAuthorityFingerprint = assertSha256(evidence.currentAuthorityFingerprint, 'evidence.currentAuthorityFingerprint');
  const validatedAt = dateIso(evidence.validatedAt, 'evidence.validatedAt');

  if (evidence.mergedRouteCommitContainedInCurrentMain !== true) reasons.push('MERGED_ROUTE_COMMIT_NOT_PROVEN_IN_CURRENT_MAIN');
  if (currentAuthorityFingerprint !== expectedFingerprint) reasons.push('MOUNTED_AUTHORITY_FINGERPRINT_MISMATCH');
  if (!exactStringSet(evidence.verifiedGuardedPaths, mountedBasis.guardedPaths)) reasons.push('GUARDED_PATH_SET_NOT_VERIFIED');
  if (evidence.authTenantIsolationVerified !== true) reasons.push('AUTH_TENANT_ISOLATION_NOT_VERIFIED');
  if (evidence.aggregateOnlyResponseVerified !== true) reasons.push('AGGREGATE_ONLY_RESPONSE_NOT_VERIFIED');
  if (evidence.noExecutionAuthorityGrantedVerified !== true) reasons.push('EXECUTION_AUTHORITY_SEPARATION_NOT_VERIFIED');

  const gateResults = evidence.gateResults && typeof evidence.gateResults === 'object' && !Array.isArray(evidence.gateResults)
    ? evidence.gateResults
    : {};
  for (const gate of WISERR_GROWTH_SNAPSHOT_REQUIRED_GATES) {
    const result = normalizedGateResult(gateResults[gate]);
    if (!result) {
      reasons.push(`MISSING_GATE_EVIDENCE:${gate}`);
      continue;
    }
    if (result.conclusion !== 'success') reasons.push(`GATE_NOT_GREEN:${gate}`);
    if (result.headSha !== routePrHeadSha) reasons.push(`GATE_HEAD_MISMATCH:${gate}`);
  }

  return {
    decision: reasons.length
      ? WISERR_GROWTH_SNAPSHOT_CERTIFICATION_DECISIONS.BLOCKED
      : WISERR_GROWTH_SNAPSHOT_CERTIFICATION_DECISIONS.CERTIFIABLE,
    reasons,
    expectedAuthorityFingerprint: expectedFingerprint,
    routePrHeadSha,
    mergedRouteCommitSha,
    currentCommitSha,
    validatedAt,
    guardedPaths: [...mountedBasis.guardedPaths].sort()
  };
}

export function buildCertifiedWiserrGrowthSnapshotReceipt({
  evidence,
  mountedBasis = candidateWiserrGrowthSnapshotMountedBasis(),
  validUntil = null
}) {
  const evaluation = evaluateWiserrMountedSnapshotCertification({ evidence, mountedBasis });
  if (evaluation.decision !== WISERR_GROWTH_SNAPSHOT_CERTIFICATION_DECISIONS.CERTIFIABLE) {
    const error = new Error(`WISERR_GROWTH_SNAPSHOT_CERTIFICATION_BLOCKED:${evaluation.reasons.join('|')}`);
    error.reasons = [...evaluation.reasons];
    throw error;
  }

  let normalizedValidUntil = null;
  if (validUntil !== null) {
    normalizedValidUntil = dateIso(validUntil, 'validUntil');
    if (Date.parse(normalizedValidUntil) <= Date.parse(evaluation.validatedAt)) {
      throw new Error('validUntil must be later than validatedAt.');
    }
  }

  const receipt = {
    schemaVersion: 1,
    dependencyId: WISERR_GROWTH_SNAPSHOT_DEPENDENCY_ID,
    system: 'WISERR_OS',
    repository: 'mottadavid/Wiserr-OS',
    contractName: mountedBasis.contractName,
    contractVersion: mountedBasis.contractVersion,
    status: 'CERTIFIED',
    validatedCommitSha: evaluation.currentCommitSha,
    authorityFingerprint: evaluation.expectedAuthorityFingerprint,
    validatedAt: evaluation.validatedAt,
    validUntil: normalizedValidUntil,
    guardedPaths: [...mountedBasis.guardedPaths].sort(),
    capabilities: { ...mountedBasis.capabilities },
    evidence: [
      {
        kind: 'MERGED_ROUTE',
        reference: `mottadavid/Wiserr-OS@${evaluation.mergedRouteCommitSha}`,
        headSha: evaluation.routePrHeadSha
      },
      {
        kind: 'CURRENT_MAIN_AUTHORITY',
        reference: `mottadavid/Wiserr-OS@${evaluation.currentCommitSha}`,
        authorityFingerprint: evaluation.expectedAuthorityFingerprint
      },
      {
        kind: 'CI_GATES',
        requiredGates: [...WISERR_GROWTH_SNAPSHOT_REQUIRED_GATES],
        headSha: evaluation.routePrHeadSha
      }
    ],
    notes: 'Certifies only the bounded authenticated aggregate growth snapshot read surface. This receipt grants no messaging, capacity, Luna, booking, or revenue outcome authority.'
  };

  validateUpstreamAuthorityReceipt(receipt);
  if (receipt.capabilities.reactivationSmsExecution || receipt.capabilities.reactivationEmailExecution || receipt.capabilities.lunaCampaignContext || receipt.capabilities.canonicalBookingOutcomeEvents || receipt.capabilities.canonicalWonRevenueOutcomeEvents) {
    throw new Error('Mounted snapshot certification must not grant execution, Luna, or outcome capabilities.');
  }
  return receipt;
}
