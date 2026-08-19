import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WISERR_GROWTH_SNAPSHOT_REQUIRED_GATES,
  WISERR_GROWTH_SNAPSHOT_CERTIFICATION_DECISIONS,
  evaluateWiserrMountedSnapshotCertification,
  buildCertifiedWiserrGrowthSnapshotReceipt
} from '../src/integrations/wiserr/growth-snapshot-certification.mjs';
import {
  candidateWiserrGrowthSnapshotMountedBasis,
  wiserrGrowthSnapshotAuthorityFingerprint
} from '../src/integrations/wiserr/growth-snapshot-authority.mjs';
import { evaluateUpstreamAuthority } from '../src/core/upstream-authority.mjs';

const HEAD = 'a'.repeat(40);
const MERGED = 'b'.repeat(40);
const CURRENT = 'c'.repeat(40);
const VALIDATED_AT = '2026-08-19T20:00:00.000Z';

function goodEvidence(overrides = {}) {
  const basis = candidateWiserrGrowthSnapshotMountedBasis();
  return {
    repository: 'mottadavid/Wiserr-OS',
    routeMerged: true,
    routePrHeadSha: HEAD,
    mergedRouteCommitSha: MERGED,
    currentCommitSha: CURRENT,
    mergedRouteCommitContainedInCurrentMain: true,
    currentAuthorityFingerprint: wiserrGrowthSnapshotAuthorityFingerprint(basis),
    verifiedGuardedPaths: [...basis.guardedPaths],
    authTenantIsolationVerified: true,
    aggregateOnlyResponseVerified: true,
    noExecutionAuthorityGrantedVerified: true,
    gateResults: Object.fromEntries(WISERR_GROWTH_SNAPSHOT_REQUIRED_GATES.map(name => [name, { conclusion: 'success', headSha: HEAD }])),
    validatedAt: VALIDATED_AT,
    ...overrides
  };
}

test('exact mounted evidence is certifiable and produces a read-only authority receipt', () => {
  const evaluation = evaluateWiserrMountedSnapshotCertification({ evidence: goodEvidence() });
  assert.equal(evaluation.decision, WISERR_GROWTH_SNAPSHOT_CERTIFICATION_DECISIONS.CERTIFIABLE);
  assert.deepEqual(evaluation.reasons, []);

  const receipt = buildCertifiedWiserrGrowthSnapshotReceipt({ evidence: goodEvidence() });
  assert.equal(receipt.status, 'CERTIFIED');
  assert.equal(receipt.validatedCommitSha, CURRENT);
  assert.equal(receipt.capabilities.aggregateGrowthSnapshotProducer, true);
  assert.equal(receipt.capabilities.readGrowthSnapshot, true);
  assert.equal(receipt.capabilities.reactivationSmsExecution, false);
  assert.equal(receipt.capabilities.reactivationEmailExecution, false);
  assert.equal(receipt.capabilities.lunaCampaignContext, false);
  assert.equal(receipt.capabilities.canonicalBookingOutcomeEvents, false);
  assert.equal(receipt.capabilities.canonicalWonRevenueOutcomeEvents, false);

  const authority = evaluateUpstreamAuthority({
    receipt,
    currentCommitSha: CURRENT,
    currentAuthorityFingerprint: receipt.authorityFingerprint,
    requiredCapabilities: ['readGrowthSnapshot'],
    now: new Date(VALIDATED_AT)
  });
  assert.equal(authority.decision, 'READY');
});

test('every required gate must be green on the exact route head', () => {
  for (const gate of WISERR_GROWTH_SNAPSHOT_REQUIRED_GATES) {
    const failed = goodEvidence();
    failed.gateResults[gate] = { conclusion: 'failure', headSha: HEAD };
    const failedEvaluation = evaluateWiserrMountedSnapshotCertification({ evidence: failed });
    assert.equal(failedEvaluation.decision, 'BLOCKED');
    assert.ok(failedEvaluation.reasons.includes(`GATE_NOT_GREEN:${gate}`));

    const stale = goodEvidence();
    stale.gateResults[gate] = { conclusion: 'success', headSha: 'd'.repeat(40) };
    const staleEvaluation = evaluateWiserrMountedSnapshotCertification({ evidence: stale });
    assert.equal(staleEvaluation.decision, 'BLOCKED');
    assert.ok(staleEvaluation.reasons.includes(`GATE_HEAD_MISMATCH:${gate}`));
  }
});

test('route must be merged and proven contained in current main', () => {
  const unmerged = evaluateWiserrMountedSnapshotCertification({ evidence: goodEvidence({ routeMerged: false }) });
  assert.ok(unmerged.reasons.includes('ROUTE_NOT_MERGED'));

  const notContained = evaluateWiserrMountedSnapshotCertification({ evidence: goodEvidence({ mergedRouteCommitContainedInCurrentMain: false }) });
  assert.ok(notContained.reasons.includes('MERGED_ROUTE_COMMIT_NOT_PROVEN_IN_CURRENT_MAIN'));
});

test('semantic fingerprint and exact guarded path set are load-bearing', () => {
  const changedFingerprint = evaluateWiserrMountedSnapshotCertification({ evidence: goodEvidence({ currentAuthorityFingerprint: 'e'.repeat(64) }) });
  assert.ok(changedFingerprint.reasons.includes('MOUNTED_AUTHORITY_FINGERPRINT_MISMATCH'));

  const missingPathEvidence = goodEvidence();
  missingPathEvidence.verifiedGuardedPaths = missingPathEvidence.verifiedGuardedPaths.slice(1);
  const missingPath = evaluateWiserrMountedSnapshotCertification({ evidence: missingPathEvidence });
  assert.ok(missingPath.reasons.includes('GUARDED_PATH_SET_NOT_VERIFIED'));
});

test('auth isolation, aggregate-only response, and authority separation are independently required', () => {
  const auth = evaluateWiserrMountedSnapshotCertification({ evidence: goodEvidence({ authTenantIsolationVerified: false }) });
  assert.ok(auth.reasons.includes('AUTH_TENANT_ISOLATION_NOT_VERIFIED'));

  const privacy = evaluateWiserrMountedSnapshotCertification({ evidence: goodEvidence({ aggregateOnlyResponseVerified: false }) });
  assert.ok(privacy.reasons.includes('AGGREGATE_ONLY_RESPONSE_NOT_VERIFIED'));

  const separation = evaluateWiserrMountedSnapshotCertification({ evidence: goodEvidence({ noExecutionAuthorityGrantedVerified: false }) });
  assert.ok(separation.reasons.includes('EXECUTION_AUTHORITY_SEPARATION_NOT_VERIFIED'));
});

test('blocked evidence cannot build a certified receipt', () => {
  assert.throws(
    () => buildCertifiedWiserrGrowthSnapshotReceipt({ evidence: goodEvidence({ routeMerged: false }) }),
    /WISERR_GROWTH_SNAPSHOT_CERTIFICATION_BLOCKED/
  );
});

test('receipt validity window must be explicit and forward-moving when supplied', () => {
  const receipt = buildCertifiedWiserrGrowthSnapshotReceipt({
    evidence: goodEvidence(),
    validUntil: '2026-08-20T20:00:00.000Z'
  });
  assert.equal(receipt.validUntil, '2026-08-20T20:00:00.000Z');
  assert.throws(
    () => buildCertifiedWiserrGrowthSnapshotReceipt({ evidence: goodEvidence(), validUntil: VALIDATED_AT }),
    /validUntil must be later than validatedAt/
  );
});
