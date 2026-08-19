import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentWiserrGrowthSnapshotProducerBasis,
  candidateWiserrGrowthSnapshotMountedBasis,
  validateWiserrGrowthSnapshotAuthorityBasis,
  wiserrGrowthSnapshotAuthorityFingerprint
} from '../src/integrations/wiserr/growth-snapshot-authority.mjs';

const CURRENT_UNMOUNTED_FINGERPRINT = '5682a8ce6223466f7f391929d5957515fef34c918cacc52a202041324f2c1588';
const CANDIDATE_MOUNTED_FINGERPRINT = 'dc668aba790e96d633f0faba1ab6bdcfd96123cf1ff034b10a7655d13d9b683a';

test('current unmounted producer basis guards only the actual audited producer surfaces', () => {
  const basis = currentWiserrGrowthSnapshotProducerBasis();
  assert.equal(validateWiserrGrowthSnapshotAuthorityBasis(basis), basis);
  assert.deepEqual([...basis.guardedPaths].sort(), [
    'docs/growth/GROWTHOS_READ_CONTRACT.md',
    'server/growth/growthSnapshotService.ts',
    'tests/growth/growthSnapshotService.test.ts'
  ]);
  assert.equal(basis.guardedPaths.includes('docs/growth/GROWTHOS_WISERR_AUTHORITY_CONTRACT.md'), false);
  assert.equal(basis.guardedPaths.includes('server/routes/tenantInfoRoutes.ts'), false);
  assert.equal(basis.guardedPaths.includes('server/index.ts'), false);
  assert.equal(basis.readSurface.mounted, false);
  assert.equal(basis.capabilities.readGrowthSnapshot, false);
});

test('same semantic basis yields the pinned deterministic unmounted-producer fingerprint', () => {
  const first = currentWiserrGrowthSnapshotProducerBasis();
  const second = structuredClone(first);
  second.guardedPaths = [...second.guardedPaths].reverse();
  assert.equal(wiserrGrowthSnapshotAuthorityFingerprint(first), wiserrGrowthSnapshotAuthorityFingerprint(second));
  assert.equal(wiserrGrowthSnapshotAuthorityFingerprint(first), CURRENT_UNMOUNTED_FINGERPRINT);
});

test('candidate mounted basis pins the exact route, mount, auth and privacy authority without execution authority', () => {
  const basis = candidateWiserrGrowthSnapshotMountedBasis();
  assert.equal(validateWiserrGrowthSnapshotAuthorityBasis(basis), basis);
  assert.equal(basis.readSurface.mounted, true);
  assert.equal(basis.readSurface.routeOrService, 'GET /api/tenant/growth/snapshot?dormantDays=<1..3650>');
  assert.equal(basis.readSurface.authAuthority, 'requireAuth -> setTenantFromToken -> rejectTenantParam -> owner/admin/super_admin');
  assert.equal(basis.capabilities.readGrowthSnapshot, true);
  assert.equal(basis.capabilities.reactivationSmsExecution, false);
  assert.equal(basis.capabilities.reactivationEmailExecution, false);
  assert.equal(basis.capabilities.lunaCampaignContext, false);
  assert.equal(basis.capabilities.canonicalBookingOutcomeEvents, false);
  assert.equal(basis.capabilities.canonicalWonRevenueOutcomeEvents, false);
  assert.deepEqual([...basis.guardedPaths].sort(), [
    'docs/growth/GROWTHOS_READ_CONTRACT.md',
    'server/authMiddleware.ts',
    'server/growth/growthSnapshotService.ts',
    'server/index.ts',
    'server/middleware/rejectTenantParam.ts',
    'server/routes/growthSnapshotRoute.ts',
    'server/routes/tenantProfileRoute.ts',
    'tests/growth/growthSnapshotRoute.test.ts',
    'tests/growth/growthSnapshotService.test.ts'
  ]);
  assert.equal(wiserrGrowthSnapshotAuthorityFingerprint(basis), CANDIDATE_MOUNTED_FINGERPRINT);
});

test('same mounted semantics remain deterministic regardless of guarded path order', () => {
  const basis = candidateWiserrGrowthSnapshotMountedBasis();
  const reversed = structuredClone(basis);
  reversed.guardedPaths.reverse();
  assert.equal(wiserrGrowthSnapshotAuthorityFingerprint(reversed), CANDIDATE_MOUNTED_FINGERPRINT);
});

test('non-semantic implementation metadata does not change the contract fingerprint', () => {
  const basis = currentWiserrGrowthSnapshotProducerBasis();
  const withImplementationDetail = {
    ...structuredClone(basis),
    implementationNote: 'Type row now extends Record<string, unknown>.'
  };
  assert.equal(
    wiserrGrowthSnapshotAuthorityFingerprint(basis),
    wiserrGrowthSnapshotAuthorityFingerprint(withImplementationDetail)
  );
});

test('cohort semantic change changes the fingerprint', () => {
  const basis = currentWiserrGrowthSnapshotProducerBasis();
  const changed = structuredClone(basis);
  changed.cohort.channelEligibility = 'different_semantics';
  assert.notEqual(
    wiserrGrowthSnapshotAuthorityFingerprint(basis),
    wiserrGrowthSnapshotAuthorityFingerprint(changed)
  );
});

test('mounting a read surface changes the fingerprint and contradictory capability fails closed', () => {
  const unmounted = currentWiserrGrowthSnapshotProducerBasis();
  const mounted = candidateWiserrGrowthSnapshotMountedBasis();
  assert.notEqual(
    wiserrGrowthSnapshotAuthorityFingerprint(unmounted),
    wiserrGrowthSnapshotAuthorityFingerprint(mounted)
  );

  const contradictory = structuredClone(mounted);
  contradictory.capabilities.readGrowthSnapshot = false;
  assert.throws(
    () => validateWiserrGrowthSnapshotAuthorityBasis(contradictory),
    /readGrowthSnapshot capability must match readSurface.mounted/
  );
});

test('producer basis cannot silently claim complete capacity or recipient PII', () => {
  const capacityChanged = currentWiserrGrowthSnapshotProducerBasis();
  capacityChanged.planningState.capacityStatus = 'AVAILABLE';
  assert.throws(() => validateWiserrGrowthSnapshotAuthorityBasis(capacityChanged), /capacity must remain UNKNOWN/);

  const privacyChanged = currentWiserrGrowthSnapshotProducerBasis();
  privacyChanged.privacy.noRecipientPII = false;
  assert.throws(() => validateWiserrGrowthSnapshotAuthorityBasis(privacyChanged), /noRecipientPII must be true/);
});
