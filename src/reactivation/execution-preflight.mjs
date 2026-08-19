import { validateCapacityExecutionProof } from '../core/capacity-execution-proof.mjs';
import { channelEligibility, validateWiserrGrowthSnapshot } from '../integrations/wiserr/growth-snapshot.mjs';
import { isWiserrReactivationSmsExecutionAuthorityReady } from '../integrations/wiserr/reactivation-sms-authority.mjs';

export const REACTIVATION_PREFLIGHT_DECISIONS = Object.freeze({
  READY: 'READY',
  DENY: 'DENY',
  NO_ACTION: 'NO_ACTION'
});

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

export function evaluateReactivationExecutionPrerequisites({
  tenantId,
  currentSnapshot,
  channel,
  capacityProof,
  executionAuthorityDecision,
  now = new Date()
}) {
  requiredString(tenantId, 'tenantId');
  validateWiserrGrowthSnapshot(currentSnapshot);
  if (currentSnapshot.tenantId !== tenantId) {
    return { decision: REACTIVATION_PREFLIGHT_DECISIONS.DENY, reasons: ['CURRENT_SNAPSHOT_TENANT_MISMATCH'] };
  }
  if (['STALE', 'UNAVAILABLE'].includes(currentSnapshot.completeness)) {
    return { decision: REACTIVATION_PREFLIGHT_DECISIONS.NO_ACTION, reasons: ['CURRENT_BUSINESS_STATE_NOT_FRESH_ENOUGH'] };
  }

  try {
    validateCapacityExecutionProof(capacityProof, { tenantId, now });
  } catch (error) {
    const noAction = ['CAPACITY_EXECUTION_PROOF_NOT_AVAILABLE','CAPACITY_EXECUTION_PROOF_EXPIRED','CAPACITY_EXECUTION_PROOF_NOT_YET_VALID'].includes(error.message);
    return {
      decision: noAction ? REACTIVATION_PREFLIGHT_DECISIONS.NO_ACTION : REACTIVATION_PREFLIGHT_DECISIONS.DENY,
      reasons: [error.message === 'capacity proof must be an object.' ? 'CAPACITY_EXECUTION_PROOF_REQUIRED' : error.message]
    };
  }

  if (!isWiserrReactivationSmsExecutionAuthorityReady(executionAuthorityDecision)) {
    return {
      decision: REACTIVATION_PREFLIGHT_DECISIONS.DENY,
      reasons: [
        'WISERR_REACTIVATION_SMS_EXECUTION_AUTHORITY_NOT_READY',
        ...(executionAuthorityDecision?.reasons || [])
      ]
    };
  }

  const eligibility = channelEligibility(currentSnapshot, channel);
  if (eligibility.eligibleRecipients < 1) {
    return { decision: REACTIVATION_PREFLIGHT_DECISIONS.NO_ACTION, reasons: ['NO_CURRENTLY_ELIGIBLE_RECIPIENTS'] };
  }

  return {
    decision: REACTIVATION_PREFLIGHT_DECISIONS.READY,
    reasons: ['REACTIVATION_EXECUTION_PREREQUISITES_READY'],
    tenantId,
    currentSnapshotId: currentSnapshot.snapshotId,
    currentEligibleRecipients: eligibility.eligibleRecipients,
    capacityBundleId: capacityProof.capacityBundleId,
    capacityProofHash: capacityProof.proofHash,
    capacitySemanticHash: capacityProof.capacitySemanticHash,
    capacityAuthorityHash: capacityProof.authorityHash,
    executionAuthorityDependencyId: executionAuthorityDecision.metadata.dependencyId,
    executionAuthorityLockFingerprint: executionAuthorityDecision.metadata.lockFingerprint ?? null
  };
}
