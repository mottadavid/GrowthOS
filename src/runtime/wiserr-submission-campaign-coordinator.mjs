import { assertExecutionRuntime } from './bootstrap.mjs';
import { ingestWiserrReactivationSubmissionResult } from './wiserr-submission-result-ingestion.mjs';
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

export async function ingestWiserrReactivationSubmissionResultAndAdvanceCampaign({ runtime, result, now = new Date() }) {
  if (!result || typeof result !== 'object') throw new Error('result is required.');
  requiredString(result.tenantId, 'result.tenantId');
  requiredString(result.commandId, 'result.commandId');
  requiredString(result.attemptId, 'result.attemptId');
  if (runtime?.tenantId !== result.tenantId) throw new Error('WISERR_SUBMISSION_COORDINATOR_RUNTIME_TENANT_MISMATCH');
  const store = assertExecutionRuntime(runtime);

  const applied = await ingestWiserrReactivationSubmissionResult({ runtime, result, now });
  const commandRecord = await loadDurableWiserrReactivationCommand({ store, tenantId: result.tenantId, commandId: result.commandId });
  if (!commandRecord) throw new Error('WISERR_SUBMISSION_COORDINATOR_COMMAND_NOT_FOUND');
  const command = commandRecord.payload.command;
  let campaignRecord = await loadDurableReactivationCampaign({ store, tenantId: result.tenantId, campaignId: command.campaignId });
  if (!campaignRecord) throw new Error('WISERR_SUBMISSION_COORDINATOR_CAMPAIGN_NOT_FOUND');
  assertCampaignIdentity(campaignRecord.payload, command, result);

  const reason = reasonFor(result);
  let campaignTransitioned = false;

  if (result.outcome === 'ACCEPTED') {
    if (!['EXECUTING', 'OBSERVING', 'COMPLETED'].includes(campaignRecord.payload.status)) {
      throw new Error(`WISERR_SUBMISSION_CAMPAIGN_RESULT_STATE_CONFLICT:${campaignRecord.payload.status}`);
    }
  } else if (result.outcome === 'COMPLETED') {
    if (campaignRecord.payload.status === 'EXECUTING') {
      campaignRecord = await markDurableReactivationCampaignObserving({ store, tenantId: result.tenantId, campaignId: command.campaignId, now });
      campaignTransitioned = true;
    } else if (!['OBSERVING', 'COMPLETED'].includes(campaignRecord.payload.status)) {
      throw new Error(`WISERR_SUBMISSION_CAMPAIGN_RESULT_STATE_CONFLICT:${campaignRecord.payload.status}`);
    }
  } else if (result.outcome === 'AMBIGUOUS') {
    if (campaignRecord.payload.status === 'EXECUTING') {
      campaignRecord = await markDurableReactivationCampaignReconciliationRequired({ store, tenantId: result.tenantId, campaignId: command.campaignId, reason, now });
      campaignTransitioned = true;
    } else if (campaignRecord.payload.status === 'RECONCILIATION_REQUIRED') {
      assertExistingReason(campaignRecord.payload.failureReason, reason, 'WISERR_SUBMISSION_CAMPAIGN_RECONCILIATION_REASON_CONFLICT');
    } else {
      throw new Error(`WISERR_SUBMISSION_CAMPAIGN_RESULT_STATE_CONFLICT:${campaignRecord.payload.status}`);
    }
  } else if (result.outcome === 'SUPPRESSED') {
    if (campaignRecord.payload.status === 'EXECUTING') {
      campaignRecord = await stopDurableReactivationCampaign({ store, tenantId: result.tenantId, campaignId: command.campaignId, reason, now });
      campaignTransitioned = true;
    } else if (campaignRecord.payload.status === 'STOPPED') {
      assertExistingReason(campaignRecord.payload.stopReason, reason, 'WISERR_SUBMISSION_CAMPAIGN_STOP_REASON_CONFLICT');
    } else {
      throw new Error(`WISERR_SUBMISSION_CAMPAIGN_RESULT_STATE_CONFLICT:${campaignRecord.payload.status}`);
    }
  } else if (['NOT_ACCEPTED', 'DEFINITIVE_FAILURE'].includes(result.outcome)) {
    if (campaignRecord.payload.status === 'EXECUTING') {
      campaignRecord = await failDurableReactivationCampaign({ store, tenantId: result.tenantId, campaignId: command.campaignId, reason, now });
      campaignTransitioned = true;
    } else if (campaignRecord.payload.status === 'FAILED') {
      assertExistingReason(campaignRecord.payload.failureReason, reason, 'WISERR_SUBMISSION_CAMPAIGN_FAILURE_REASON_CONFLICT');
    } else {
      throw new Error(`WISERR_SUBMISSION_CAMPAIGN_RESULT_STATE_CONFLICT:${campaignRecord.payload.status}`);
    }
  } else {
    throw new Error(`WISERR_SUBMISSION_CAMPAIGN_RESULT_OUTCOME_UNSUPPORTED:${result.outcome}`);
  }

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
