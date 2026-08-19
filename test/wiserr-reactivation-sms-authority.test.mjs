import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WISERR_REACTIVATION_SMS_DEPENDENCY_ID,
  currentWiserrReactivationSmsObservedBasis,
  validateWiserrReactivationSmsAuthorityBasis,
  wiserrReactivationSmsAuthorityFingerprint,
  evaluateWiserrReactivationSmsExecutionAuthority
} from '../src/integrations/wiserr/reactivation-sms-authority.mjs';

const WISERR_SHA = '76fbac41e6d7d2080e4fd54e4a64ce12d32ba5e5';
const OBSERVED_FP = '40f333cfe7e0847652f5184386d82520ad40d1739aabd3656b0f23f1d7fbd1e9';

function receipt(overrides = {}) {
  return {
    schemaVersion: 1,
    dependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID,
    system: 'WISERR_OS',
    repository: 'mottadavid/Wiserr-OS',
    contractName: 'wiserr-reactivation-sms',
    contractVersion: '1',
    status: 'CERTIFIED',
    validatedCommitSha: WISERR_SHA,
    authorityFingerprint: 'a'.repeat(64),
    validatedAt: '2026-08-19T02:00:00.000Z',
    validUntil: null,
    guardedPaths: ['server/messaging/sendTenantSms.ts'],
    capabilities: { reactivationSmsExecution: true },
    evidence: [],
    notes: '',
    ...overrides
  };
}

test('current audited Wiserr SMS basis is valid, deterministic, and non-executable', () => {
  const basis = currentWiserrReactivationSmsObservedBasis();
  assert.equal(validateWiserrReactivationSmsAuthorityBasis(basis), basis);
  assert.equal(basis.purpose.declared, false);
  assert.equal(basis.purpose.sharedCampaignAllowlisted, false);
  assert.equal(basis.carrierCoverage.status, 'UNVERIFIED');
  assert.equal(basis.capabilities.reactivationSmsExecution, false);
  assert.equal(wiserrReactivationSmsAuthorityFingerprint(basis), OBSERVED_FP);
});

test('execution capability cannot be declared before purpose, review, allowlist and carrier coverage are all proven', () => {
  const cases = [];

  const missingPurpose = currentWiserrReactivationSmsObservedBasis();
  missingPurpose.capabilities.reactivationSmsExecution = true;
  cases.push(missingPurpose);

  const missingReview = currentWiserrReactivationSmsObservedBasis();
  missingReview.purpose = { ...missingReview.purpose, declared: true, name: 'growth_reactivation', sharedCampaignAllowlisted: true };
  missingReview.carrierCoverage = {
    status: 'VERIFIED',
    registeredUseCaseEvidenceRef: 'wiserr://sms/use-case/1',
    sampleMessageEvidenceRef: 'wiserr://sms/sample/1',
    optInEvidenceRef: 'wiserr://sms/opt-in/1'
  };
  missingReview.capabilities.reactivationSmsExecution = true;
  cases.push(missingReview);

  const missingAllowlist = structuredClone(missingReview);
  missingAllowlist.purpose.complianceReviewStatus = 'APPROVED';
  missingAllowlist.purpose.sharedCampaignAllowlisted = false;
  cases.push(missingAllowlist);

  const missingCarrier = structuredClone(missingReview);
  missingCarrier.purpose.complianceReviewStatus = 'APPROVED';
  missingCarrier.carrierCoverage = {
    status: 'UNVERIFIED',
    registeredUseCaseEvidenceRef: null,
    sampleMessageEvidenceRef: null,
    optInEvidenceRef: null
  };
  cases.push(missingCarrier);

  for (const basis of cases) {
    assert.throws(() => validateWiserrReactivationSmsAuthorityBasis(basis));
  }
});

test('fully evidenced future SMS authority basis can represent execution capability', () => {
  const basis = currentWiserrReactivationSmsObservedBasis();
  basis.purpose = {
    ...basis.purpose,
    declared: true,
    name: 'growth_reactivation',
    sharedCampaignAllowlisted: true,
    complianceReviewStatus: 'APPROVED'
  };
  basis.carrierCoverage = {
    status: 'VERIFIED',
    registeredUseCaseEvidenceRef: 'wiserr://sms/use-case/1',
    sampleMessageEvidenceRef: 'wiserr://sms/sample/1',
    optInEvidenceRef: 'wiserr://sms/opt-in/1'
  };
  basis.capabilities.reactivationSmsExecution = true;
  assert.equal(validateWiserrReactivationSmsAuthorityBasis(basis), basis);
  assert.notEqual(wiserrReactivationSmsAuthorityFingerprint(basis), OBSERVED_FP);
});

test('snapshot read authority can never substitute for SMS execution authority', () => {
  const readReceipt = receipt({
    dependencyId: 'wiserr-growth-snapshot-v1',
    contractName: 'wiserr-growth-snapshot',
    capabilities: { readGrowthSnapshot: true }
  });
  const decision = evaluateWiserrReactivationSmsExecutionAuthority({
    receipt: readReceipt,
    currentCommitSha: WISERR_SHA
  });
  assert.equal(decision.decision, 'DENY');
  assert.deepEqual(decision.reasons, ['WISERR_REACTIVATION_SMS_DEPENDENCY_MISMATCH']);
});

test('observed/non-capable SMS receipt denies execution even though Wiserr transport exists', () => {
  const observed = receipt({
    status: 'OBSERVED',
    authorityFingerprint: OBSERVED_FP,
    capabilities: { reactivationSmsExecution: false }
  });
  const decision = evaluateWiserrReactivationSmsExecutionAuthority({
    receipt: observed,
    currentCommitSha: WISERR_SHA,
    currentAuthorityFingerprint: OBSERVED_FP
  });
  assert.equal(decision.decision, 'DENY');
  assert.ok(decision.reasons.includes('CAPABILITY_NOT_CERTIFIED:reactivationSmsExecution'));
});

test('only exact certified SMS dependency with execution capability can become READY', () => {
  const certified = receipt();
  const decision = evaluateWiserrReactivationSmsExecutionAuthority({
    receipt: certified,
    currentCommitSha: WISERR_SHA,
    currentAuthorityFingerprint: certified.authorityFingerprint
  });
  assert.equal(decision.decision, 'READY');
  assert.equal(decision.metadata.dependencyId, WISERR_REACTIVATION_SMS_DEPENDENCY_ID);
});
