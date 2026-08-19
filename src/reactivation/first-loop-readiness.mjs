import { validateCapacityExecutionProof } from '../core/capacity-execution-proof.mjs';
import { UPSTREAM_AUTHORITY_DECISIONS } from '../core/upstream-authority.mjs';
import { RUNTIME_MODES } from '../runtime/bootstrap.mjs';
import { evaluateWiserrGrowthSnapshotReadAuthority } from '../integrations/wiserr/read-client.mjs';
import { evaluateWiserrReactivationSmsExecutionAuthority } from '../integrations/wiserr/reactivation-sms-authority.mjs';

export const FIRST_LOOP_READINESS = Object.freeze({
  READY: 'READY',
  BLOCKED: 'BLOCKED'
});

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function blocker(code, layer, details = {}) {
  return { code, layer, details };
}

export function evaluateFirstLoopReadiness({
  tenantId,
  runtime,
  growthSnapshotReceipt,
  growthSnapshotCurrentCommitSha,
  growthSnapshotCurrentAuthorityFingerprint = null,
  capacityProof = null,
  smsReceipt,
  smsCurrentCommitSha,
  smsCurrentAuthorityFingerprint = null,
  now = new Date()
}) {
  requiredString(tenantId, 'tenantId');
  const blockers = [];

  if (!runtime || runtime.tenantId !== tenantId) {
    blockers.push(blocker('RUNTIME_TENANT_MISMATCH', 'RUNTIME'));
  } else if (runtime.mode !== RUNTIME_MODES.EXECUTION_ENABLED || runtime.executionEnabled !== true || !runtime.executionStore) {
    blockers.push(blocker('RUNTIME_EXECUTION_DISABLED', 'RUNTIME', {
      executionBlockers: Array.isArray(runtime.executionBlockers) ? [...runtime.executionBlockers] : []
    }));
  }

  let readAuthority = null;
  try {
    readAuthority = evaluateWiserrGrowthSnapshotReadAuthority({
      receipt: growthSnapshotReceipt,
      currentCommitSha: growthSnapshotCurrentCommitSha,
      currentAuthorityFingerprint: growthSnapshotCurrentAuthorityFingerprint,
      now
    });
    if (readAuthority.decision !== UPSTREAM_AUTHORITY_DECISIONS.READY) {
      blockers.push(blocker('WISERR_GROWTH_SNAPSHOT_READ_NOT_CERTIFIED', 'BUSINESS_STATE_READ', {
        reasons: [...(readAuthority.reasons || [])]
      }));
    }
  } catch (error) {
    blockers.push(blocker('WISERR_GROWTH_SNAPSHOT_READ_AUTHORITY_INVALID', 'BUSINESS_STATE_READ', {
      errorCode: error?.code || error?.message || 'UNKNOWN'
    }));
  }

  let capacityReady = false;
  if (!capacityProof) {
    blockers.push(blocker('CAPACITY_PROOF_MISSING', 'CAPACITY'));
  } else {
    try {
      validateCapacityExecutionProof(capacityProof, { tenantId, now });
      capacityReady = true;
    } catch (error) {
      blockers.push(blocker('CAPACITY_PROOF_NOT_USABLE', 'CAPACITY', {
        errorCode: error?.code || error?.message || 'UNKNOWN'
      }));
    }
  }

  let smsAuthority = null;
  try {
    smsAuthority = evaluateWiserrReactivationSmsExecutionAuthority({
      receipt: smsReceipt,
      currentCommitSha: smsCurrentCommitSha,
      currentAuthorityFingerprint: smsCurrentAuthorityFingerprint,
      now
    });
    if (smsAuthority.decision !== UPSTREAM_AUTHORITY_DECISIONS.READY) {
      blockers.push(blocker('WISERR_REACTIVATION_SMS_NOT_CERTIFIED', 'SMS_EXECUTION', {
        reasons: [...(smsAuthority.reasons || [])]
      }));
    }
  } catch (error) {
    blockers.push(blocker('WISERR_REACTIVATION_SMS_AUTHORITY_INVALID', 'SMS_EXECUTION', {
      errorCode: error?.code || error?.message || 'UNKNOWN'
    }));
  }

  return Object.freeze({
    schemaVersion: 1,
    tenantId,
    evaluatedAt: new Date(now).toISOString(),
    decision: blockers.length === 0 ? FIRST_LOOP_READINESS.READY : FIRST_LOOP_READINESS.BLOCKED,
    ready: blockers.length === 0,
    blockers,
    checks: {
      runtimeExecutionEnabled: !!runtime && runtime.tenantId === tenantId && runtime.mode === RUNTIME_MODES.EXECUTION_ENABLED && runtime.executionEnabled === true && !!runtime.executionStore,
      growthSnapshotReadCertified: readAuthority?.decision === UPSTREAM_AUTHORITY_DECISIONS.READY,
      capacityProofUsable: capacityReady,
      reactivationSmsCertified: smsAuthority?.decision === UPSTREAM_AUTHORITY_DECISIONS.READY
    }
  });
}
