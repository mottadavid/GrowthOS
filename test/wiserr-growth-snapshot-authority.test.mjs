import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentWiserrGrowthSnapshotProducerBasis,
  validateWiserrGrowthSnapshotAuthorityBasis,
  wiserrGrowthSnapshotAuthorityFingerprint
} from '../src/integrations/wiserr/growth-snapshot-authority.mjs';

test('current producer basis is valid and uses the actual audited guarded paths', () => {
  const basis = currentWiserrGrowthSnapshotProducerBasis();
  assert.equal(validateWiserrGrowthSnapshotAuthorityBasis(basis), basis);
  assert.equal(basis.guardedPaths.includes('docs/growth/GROWTHOS_READ_CONTRACT.md'), true);
  assert.equal(basis.guardedPaths.includes('docs/growth/GROWTHOS_WISERR_AUTHORITY_CONTRACT.md'), false);
  assert.equal(basis.readSurface.mounted, false);
  assert.equal(basis.capabilities.readGrowthSnapshot, false);
});

test('same semantic basis yields a deterministic fingerprint', () => {
  const first = currentWiserrGrowthSnapshotProducerBasis();
  const second = structuredClone(first);
  second.guardedPaths = [...second.guardedPaths].reverse();
  assert.equal(wiserrGrowthSnapshotAuthorityFingerprint(first), wiserrGrowthSnapshotAuthorityFingerprint(second));
  assert.match(wiserrGrowthSnapshotAuthorityFingerprint(first), /^[0-9a-f]{64}$/);
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

test('mounting a certified read surface changes the fingerprint and requires capability agreement', () => {
  const basis = currentWiserrGrowthSnapshotProducerBasis();
  const mounted = structuredClone(basis);
  mounted.readSurface = {
    mounted: true,
    authAuthority: 'WISERR_OWNER_ADMIN_JWT',
    routeOrService: 'GET /api/tenant/growth/snapshot'
  };
  mounted.capabilities.readGrowthSnapshot = true;

  assert.notEqual(
    wiserrGrowthSnapshotAuthorityFingerprint(basis),
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
