import { EXECUTION_ATTEMPT_STATES } from '../core/execution-attempts.mjs';
import { assertExecutionRuntime } from './bootstrap.mjs';
import { loadDurableExecutionAttempt, reconcileDurableExecutionAttempt } from './execution-attempt-repository.mjs';
import {
  loadDurableReactivationCampaign,
  resolveDurableReactivationCampaignReconciliationCompleted,
  failDurableReactivationCampaign
} from './reactivation-campaign-repository.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function assertCampaignAttemptIdentity(campaign, attempt) {
  if (
    campaign.tenantId !== attempt.tenantId ||
    !Array.isArray(campaign.attemptIds) ||
    !campaign.attemptIds.includes(attempt.attemptId)
  ) {
    throw new Error('WISERR_RECONCILIATION_CAMPAIGN_ATTEMPT_MISMATCH');
  }
}

function expectedCampaignFailureReason(outcome, evidence) {
  return `WISERR_RECONCILED_${outcome}:${evidence}`;
}

function assertExistingReconciliation(attempt, { outcome, by, evidence }) {
  if (!attempt.reconciliation) throw new Error('WISERR_RECONCILIATION_EVIDENCE_MISSING');
  if (
    attempt.reconciliation.outcome !== outcome ||
    attempt.reconciliation.by !== by ||
    attempt.reconciliation.evidence !== evidence
  ) {
    throw new Error('WISERR_RECONCILIATION_EVIDENCE_CONFLICT');
  }
}

export async function reconcileWiserrReactivationSubmissionAndCampaign({
  runtime,
  tenantId,
  campaignId,
  attemptId,
  outcome,
  by,
  evidence,
  now = new Date()
}) {
  requiredString(tenantId, 'tenantId');
  requiredString(campaignId, 'campaignId');
  requiredString(attemptId, 'attemptId');
  requiredString(by, 'by');
  requiredString(evidence, 'evidence');
  if (!['COMPLETED', 'FAILED', 'NOT_ACCEPTED'].includes(outcome)) throw new Error('Invalid reconciliation outcome.');
  if (runtime?.tenantId !== tenantId) throw new Error('WISERR_RECONCILIATION_RUNTIME_TENANT_MISMATCH');
  const store = assertExecutionRuntime(runtime);

  let campaignRecord = await loadDurableReactivationCampaign({ store, tenantId, campaignId });
  if (!campaignRecord) throw new Error('WISERR_RECONCILIATION_CAMPAIGN_NOT_FOUND');
  let attemptRecord = await loadDurableExecutionAttempt({ store, tenantId, attemptId });
  if (!attemptRecord) throw new Error('WISERR_RECONCILIATION_ATTEMPT_NOT_FOUND');
  assertCampaignAttemptIdentity(campaignRecord.payload, attemptRecord.payload);

  const completedResolution = outcome === 'COMPLETED';
  const allowedCampaignStates = completedResolution ? ['RECONCILIATION_REQUIRED', 'OBSERVING', 'COMPLETED'] : ['RECONCILIATION_REQUIRED', 'FAILED'];
  if (!allowedCampaignStates.includes(campaignRecord.payload.status)) {
    throw new Error(`WISERR_RECONCILIATION_CAMPAIGN_STATE_CONFLICT:${campaignRecord.payload.status}`);
  }

  let attemptTransitioned = false;
  if (attemptRecord.payload.state === EXECUTION_ATTEMPT_STATES.RECONCILIATION_REQUIRED) {
    attemptRecord = await reconcileDurableExecutionAttempt({
      store,
      tenantId,
      attemptId,
      outcome,
      by,
      evidence,
      result: completedResolution ? { reconciliationEvidenceRef: evidence } : null,
      now
    });
    attemptTransitioned = true;
  } else {
    const expectedState = completedResolution ? EXECUTION_ATTEMPT_STATES.RECONCILED_COMPLETED : EXECUTION_ATTEMPT_STATES.RECONCILED_FAILED;
    if (attemptRecord.payload.state !== expectedState) {
      throw new Error(`WISERR_RECONCILIATION_ATTEMPT_STATE_CONFLICT:${attemptRecord.payload.state}`);
    }
    assertExistingReconciliation(attemptRecord.payload, { outcome, by, evidence });
  }

  campaignRecord = await loadDurableReactivationCampaign({ store, tenantId, campaignId });
  let campaignTransitioned = false;
  if (completedResolution) {
    if (campaignRecord.payload.status === 'RECONCILIATION_REQUIRED') {
      campaignRecord = await resolveDurableReactivationCampaignReconciliationCompleted({ store, tenantId, campaignId, evidenceRef: evidence, now });
      campaignTransitioned = true;
    }
  } else {
    const reason = expectedCampaignFailureReason(outcome, evidence);
    if (campaignRecord.payload.status === 'RECONCILIATION_REQUIRED') {
      campaignRecord = await failDurableReactivationCampaign({ store, tenantId, campaignId, reason, now });
      campaignTransitioned = true;
    } else if (campaignRecord.payload.status === 'FAILED' && campaignRecord.payload.failureReason !== reason) {
      throw new Error('WISERR_RECONCILIATION_CAMPAIGN_FAILURE_REASON_CONFLICT');
    }
  }

  return {
    schemaVersion: 1,
    tenantId,
    campaignId,
    attemptId,
    outcome,
    attemptState: attemptRecord.payload.state,
    campaignState: campaignRecord.payload.status,
    attemptTransitioned,
    campaignTransitioned
  };
}
