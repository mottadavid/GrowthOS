import { sha256Canonical } from '../../core/canonical.mjs';
import {
  evaluateUpstreamAuthority,
  UPSTREAM_AUTHORITY_DECISIONS
} from '../../core/upstream-authority.mjs';

export const WISERR_REACTIVATION_SMS_DEPENDENCY_ID = 'wiserr-reactivation-sms-v1';
export const WISERR_REACTIVATION_SMS_CONTRACT_NAME = 'wiserr-reactivation-sms';
export const WISERR_REACTIVATION_SMS_CAPABILITY = 'reactivationSmsExecution';

const REQUIRED_EXECUTION_CERTIFICATION_FIELDS = Object.freeze([
  'stableCorrelationIdentity',
  'orchestratorIdempotencyPropagation',
  'canonicalSubmissionResultClassification',
  'durableResultEvidenceReference',
  'suppressionClassificationPreserved',
  'ambiguousOutcomeLookupContract'
]);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function exactBoolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean.`);
  return value;
}

function validateEvidenceRef(value, label, required) {
  if (value === null && !required) return null;
  return requiredString(value, label);
}

export function validateWiserrReactivationSmsAuthorityBasis(basis) {
  if (!basis || typeof basis !== 'object' || Array.isArray(basis)) throw new Error('basis must be an object.');
  if (basis.schemaVersion !== 1) throw new Error('Unsupported basis.schemaVersion.');
  if (basis.contractName !== WISERR_REACTIVATION_SMS_CONTRACT_NAME) throw new Error('Unexpected basis.contractName.');
  if (basis.contractVersion !== '1') throw new Error('Unexpected basis.contractVersion.');
  if (!Array.isArray(basis.guardedPaths) || basis.guardedPaths.length < 3) throw new Error('basis.guardedPaths must contain audited Wiserr authority paths.');
  for (const path of basis.guardedPaths) requiredString(path, 'basis.guardedPaths item');

  const purpose = basis.purpose;
  if (!purpose || typeof purpose !== 'object') throw new Error('basis.purpose is required.');
  exactBoolean(purpose.declared, 'basis.purpose.declared');
  if (purpose.declared) {
    requiredString(purpose.name, 'basis.purpose.name');
    if (purpose.name !== 'growth_reactivation') throw new Error('Certified GrowthOS SMS purpose must be growth_reactivation.');
  } else if (purpose.name !== null) {
    throw new Error('Undeclared GrowthOS SMS purpose must be null.');
  }
  if (purpose.canonicalAdapter !== 'server/messaging/sendTenantSms.ts') throw new Error('Canonical SMS adapter mismatch.');
  exactBoolean(purpose.sharedCampaignAllowlisted, 'basis.purpose.sharedCampaignAllowlisted');
  if (!['NOT_REVIEWED', 'APPROVED', 'REJECTED'].includes(purpose.complianceReviewStatus)) {
    throw new Error('Invalid purpose.complianceReviewStatus.');
  }

  const safeguards = basis.safeguards;
  if (!safeguards || typeof safeguards !== 'object') throw new Error('basis.safeguards is required.');
  for (const key of [
    'platformTenantKillSwitchFirst',
    'recipientOptOutFailClosed',
    'tenantSmsProgramGate',
    'finalRecipientEligibilityInsideWiserr',
    'tenantRateLimit',
    'productionNoSimulation',
    'directProviderBypassForbidden',
    'ambiguousOutcomeRequiresReconciliation'
  ]) {
    if (safeguards[key] !== true) throw new Error(`basis.safeguards.${key} must be true.`);
  }

  const carrier = basis.carrierCoverage;
  if (!carrier || typeof carrier !== 'object') throw new Error('basis.carrierCoverage is required.');
  if (!['UNVERIFIED', 'VERIFIED', 'NOT_COVERED'].includes(carrier.status)) throw new Error('Invalid carrierCoverage.status.');
  const carrierVerified = carrier.status === 'VERIFIED';
  validateEvidenceRef(carrier.registeredUseCaseEvidenceRef, 'carrierCoverage.registeredUseCaseEvidenceRef', carrierVerified);
  validateEvidenceRef(carrier.sampleMessageEvidenceRef, 'carrierCoverage.sampleMessageEvidenceRef', carrierVerified);
  validateEvidenceRef(carrier.optInEvidenceRef, 'carrierCoverage.optInEvidenceRef', carrierVerified);

  const execution = basis.execution;
  if (!execution || typeof execution !== 'object') throw new Error('basis.execution is required.');
  for (const key of REQUIRED_EXECUTION_CERTIFICATION_FIELDS) {
    exactBoolean(execution[key], `basis.execution.${key}`);
  }

  if (!basis.capabilities || typeof basis.capabilities !== 'object') throw new Error('basis.capabilities is required.');
  exactBoolean(basis.capabilities.reactivationSmsExecution, 'basis.capabilities.reactivationSmsExecution');

  if (basis.capabilities.reactivationSmsExecution) {
    if (!purpose.declared) throw new Error('SMS execution capability requires an explicit GrowthOS purpose.');
    if (purpose.complianceReviewStatus !== 'APPROVED') throw new Error('SMS execution capability requires approved compliance review.');
    if (!purpose.sharedCampaignAllowlisted) throw new Error('SMS execution capability requires shared-campaign allowlist approval.');
    if (!carrierVerified) throw new Error('SMS execution capability requires verified carrier campaign/consent coverage.');
    for (const key of REQUIRED_EXECUTION_CERTIFICATION_FIELDS) {
      if (execution[key] !== true) throw new Error(`SMS execution capability requires basis.execution.${key}=true.`);
    }
  }

  return basis;
}

export function wiserrReactivationSmsAuthorityFingerprint(basis) {
  validateWiserrReactivationSmsAuthorityBasis(basis);
  return sha256Canonical({
    schemaVersion: basis.schemaVersion,
    contractName: basis.contractName,
    contractVersion: basis.contractVersion,
    guardedPaths: [...basis.guardedPaths].sort(),
    purpose: basis.purpose,
    safeguards: basis.safeguards,
    carrierCoverage: basis.carrierCoverage,
    execution: basis.execution,
    capabilities: basis.capabilities
  });
}

export function currentWiserrReactivationSmsObservedBasis() {
  return {
    schemaVersion: 1,
    contractName: WISERR_REACTIVATION_SMS_CONTRACT_NAME,
    contractVersion: '1',
    guardedPaths: [
      'server/messaging/sendTenantSms.ts',
      'server/services/smsComplianceService.ts',
      'server/config/smsPlatformConfig.ts',
      'docs/build-os/adr/0002-reuse-existing-sms-runtime.md'
    ],
    purpose: {
      declared: false,
      name: null,
      canonicalAdapter: 'server/messaging/sendTenantSms.ts',
      sharedCampaignAllowlisted: false,
      complianceReviewStatus: 'NOT_REVIEWED'
    },
    safeguards: {
      platformTenantKillSwitchFirst: true,
      recipientOptOutFailClosed: true,
      tenantSmsProgramGate: true,
      finalRecipientEligibilityInsideWiserr: true,
      tenantRateLimit: true,
      productionNoSimulation: true,
      directProviderBypassForbidden: true,
      ambiguousOutcomeRequiresReconciliation: true
    },
    carrierCoverage: {
      status: 'UNVERIFIED',
      registeredUseCaseEvidenceRef: null,
      sampleMessageEvidenceRef: null,
      optInEvidenceRef: null
    },
    execution: {
      stableCorrelationIdentity: true,
      orchestratorIdempotencyPropagation: true,
      canonicalSubmissionResultClassification: false,
      durableResultEvidenceReference: false,
      suppressionClassificationPreserved: false,
      ambiguousOutcomeLookupContract: false
    },
    capabilities: {
      reactivationSmsExecution: false
    }
  };
}

export function evaluateWiserrReactivationSmsExecutionAuthority({
  receipt,
  currentCommitSha,
  currentAuthorityFingerprint = null,
  now = new Date()
}) {
  if (receipt?.dependencyId !== WISERR_REACTIVATION_SMS_DEPENDENCY_ID) {
    return {
      decision: UPSTREAM_AUTHORITY_DECISIONS.DENY,
      reasons: ['WISERR_REACTIVATION_SMS_DEPENDENCY_MISMATCH'],
      metadata: { dependencyId: receipt?.dependencyId ?? null }
    };
  }
  if (receipt?.contractName !== WISERR_REACTIVATION_SMS_CONTRACT_NAME) {
    return {
      decision: UPSTREAM_AUTHORITY_DECISIONS.DENY,
      reasons: ['WISERR_REACTIVATION_SMS_CONTRACT_MISMATCH'],
      metadata: { dependencyId: receipt.dependencyId }
    };
  }
  return evaluateUpstreamAuthority({
    receipt,
    currentCommitSha,
    currentAuthorityFingerprint,
    requiredCapabilities: [WISERR_REACTIVATION_SMS_CAPABILITY],
    now
  });
}

export function isWiserrReactivationSmsExecutionAuthorityReady(decision) {
  return !!decision
    && decision.decision === UPSTREAM_AUTHORITY_DECISIONS.READY
    && decision.metadata?.dependencyId === WISERR_REACTIVATION_SMS_DEPENDENCY_ID;
}

export function assertWiserrReactivationSmsExecutionAuthorityReady(decision) {
  if (!isWiserrReactivationSmsExecutionAuthorityReady(decision)) {
    const reasons = [
      'WISERR_REACTIVATION_SMS_EXECUTION_AUTHORITY_NOT_READY',
      ...(Array.isArray(decision?.reasons) ? decision.reasons : [])
    ];
    const error = new Error(reasons.join(':'));
    error.code = 'WISERR_REACTIVATION_SMS_EXECUTION_AUTHORITY_NOT_READY';
    error.authorityDecision = decision ?? null;
    throw error;
  }
  return true;
}
