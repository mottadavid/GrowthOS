import { assertExecutionRuntime } from './bootstrap.mjs';
import { validateWiserrSubmissionResult, ingestWiserrReactivationSubmissionResult } from './wiserr-submission-result-ingestion.mjs';
import { loadDurableWiserrReactivationCommand } from './wiserr-reactivation-command-repository.mjs';
import {
  loadDurableReactivationCampaign,
  markDurableReactivationCampaignObserving,
  markDurableReactivationCampaignReconciliationRequired,
  stopDurableReactivationCampaign,
  failDurableReactivationCampaign
} from './reactivation-campaign-repository.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function reasonFor(result) {
  return `WISERR_SUBMISSION_${result.outcome}:${result.classification}:${result.evidenceRef}`;
}

function assertCampaignIdentity(campaign, command, result) {
  if (
    campaign.tenantId !== result.tenantId ||
    campaign.campaignId !== command.campaignId ||
    command.commandId !== result.commandId ||
    command.attemptId !== result.attemptId ||
    !Array.isArray(campaign.attemptIds) ||
    !campaign.attemptIds.includes(result.attemptId)
  ) {
    throw new Error('WISERR_SUBMISSION_CAMPAIGN_RESULT_IDENTITY_MISMATCH');
  }
}

function assertExistingReason(actual, expected, code) {
  if (actual !== expected) throw new Error(code);
}

function assertCampaignCanApply(campaign, result) {
  const status = campaign.status;
  const reason = reasonFor(result);
  if (result.outcome === 'ACCEPTED' || result.outcome === 'COMPLETED') {
    if (!['EXECUTING', 'OBSERVING', 'COMPLETED'].includes(status)) throw new Error(`WISERR_SUBMISSION_CAMPAIGN_RESULT_STATE_CONFLICT:${status}`);
    return;
  }
  if (result.outcome === 'AMBIGUOUS') {
    if (status === 'RECONCILIATION_REQUIRED') assertExistingReason(campaign.failureReason, reason, 'WISERR_SUBMISSION_CAMPAIGN_RECONCILIATION_REASON_CONFLICT');
    else if (status !== 'EXECUTING') throw new Error(`WISERR_SUBMISSION_CAMPAIGN_RESULT_STATE_CONFLICT:${status}`);
    return;
  }
  if (result.outcome === 'SUPPRESSED') {
    if (status === 'STOPPED') assertExistingReason(campaign.stopReason, reason, 'WISERR_SUBMISSION_CAMPAIGN_STOP_REASON_CONFLICT');
    else if (status !== 'EXECUTING') throw new Error(`WISERR_SUBMISSION_CAMPAIGN_RESULT_STATE_CONFLICT:${status}`);
    return;
  }
  if (['NOT_ACCEPTED', 'DEFINITIVE_FAILURE'].includes(result.outcome)) {
    if (status === 'FAILED') assertExistingReason(campaign.failureReason, reason, 'WISERR_SUBMISSION_CAMPAIGN_FAILURE_REASON_CONFLICT');
    else if (status !== 'EXECUTING') throw new Error(`WISERR_SUBMISSION_CAMPAIGN_RESULT_STATE_CONFLICT:${status}`);
    return;
  }
  throw new Error(`WISERR_SUBMISSION_CAMPAIGN_RESULT_OUTCOME_UNSUPPORTED:${result.outcome}`);
}

export async function ingestWiserrReactivationSubmissionResultAndAdvanceCampaign({ runtime, result, now = new Date() }) {
  validateWiserrSubmissionResult(result);
  requiredString(result.tenantId, 'result.tenantId');
  requiredString(result.commandId, 'result.commandId');
  requiredString(result.attemptId, 'result.attemptId');
  if (runtime?.tenantId !== result.tenantId) throw new Error('WISERR_SUBMISSION_COORDINATOR_RUNTIME_TENANT_MISMATCH');
  const store = assertExecutionRuntime(runtime);

  const commandRecord = await loadDurableWiserrReactivationCommand({ store, tenantId: result.tenantId, commandId: result.commandId });
  if (!commandRecord) throw new Error('WISERR_SUBMISSION_COORDINATOR_COMMAND_NOT_FOUND');
  const command = commandRecord.payload.command;
  let campaignRecord = await loadDurableReactivationCampaign({ store, tenantId: result.tenantId, campaignId: command.campaignId });
  if (!campaignRecord) throw new Error('WISERR_SUBMISSION_COORDINATOR_CAMPAIGN_NOT_FOUND');
  assertCampaignIdentity(campaignRecord.payload, command, result);
  assertCampaignCanApply(campaignRecord.payload, result);

  const applied = await ingestWiserrReactivationSubmissionResult({ runtime, result, now });
  campaignRecord = await loadDurableReactivationCampaign({ store, tenantId: result.tenantId, campaignId: command.campaignId });
  assertCampaignIdentity(campaignRecord.payload, command, result);

  const reason = reasonFor(result);
  let campaignTransitioned = false;

  if (result.outcome === 'COMPLETED' && campaignRecord.payload.status === 'EXECUTING') {
    campaignRecord = await markDurableReactivationCampaignObserving({ store, tenantId: result.tenantId, campaignId: command.campaignId, now });
    campaignTransitioned = true;
  } else if (result.outcome === 'AMBIGUOUS' && campaignRecord.payload.status === 'EXECUTING') {
    campaignRecord = await markDurableReactivationCampaignReconciliationRequired({ store, tenantId: result.tenantId, campaignId: command.campaignId, reason, now });
    campaignTransitioned = true;
  } else if (result.outcome === 'SUPPRESSED' && campaignRecord.payload.status === 'EXECUTING') {
    campaignRecord = await stopDurableReactivationCampaign({ store, tenantId: result.tenantId, campaignId: command.campaignId, reason, now });
    campaignTransitioned = true;
  } else if (['NOT_ACCEPTED', 'DEFINITIVE_FAILURE'].includes(result.outcome) && campaignRecord.payload.status === 'EXECUTING') {
    campaignRecord = await failDurableReactivationCampaign({ store, tenantId: result.tenantId, campaignId: command.campaignId, reason, now });
    campaignTransitioned = true;
  }

  assertCampaignCanApply(campaignRecord.payload, result);
  return {
    schemaVersion: 1,
    tenantId: result.tenantId,
    commandId: result.commandId,
    attemptId: result.attemptId,
    resultId: result.resultId,
    outcome: result.outcome,
    resultIdempotent: applied.idempotent,
    attemptState: applied.attemptRecord.payload.state,
    campaignId: campaignRecord.recordId,
    campaignState: campaignRecord.payload.status,
    campaignTransitioned
  };
}
