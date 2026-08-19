import { EXECUTION_ATTEMPT_STATES } from '../core/execution-attempts.mjs';
import { loadDurableExecutionAttempt, markDurableExecutionSubmitting } from './execution-attempt-repository.mjs';
import { loadDurableReactivationCampaign, startDurableReactivationCampaignFromPersistedCommand } from './reactivation-campaign-repository.mjs';
import { loadDurableWiserrReactivationCommand } from './wiserr-reactivation-command-repository.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function assertCommandAttemptIdentity(command, attempt) {
  if (
    command.tenantId !== attempt.tenantId ||
    command.actionId !== attempt.actionId ||
    command.actionHash !== attempt.actionHash ||
    command.attemptId !== attempt.attemptId ||
    command.attemptNumber !== attempt.attemptNumber ||
    command.idempotencyKey !== attempt.idempotencyKey
  ) {
    throw new Error('WISERR_SUBMISSION_COMMAND_ATTEMPT_MISMATCH');
  }
}

function assertExecutingCampaignMatchesCommand(campaign, command) {
  if (campaign.tenantId !== command.tenantId || campaign.campaignId !== command.campaignId) {
    throw new Error('WISERR_SUBMISSION_COMMAND_CAMPAIGN_MISMATCH');
  }
  if (campaign.status !== 'EXECUTING') throw new Error('WISERR_SUBMISSION_CAMPAIGN_NOT_EXECUTING');
  if (!Array.isArray(campaign.attemptIds) || !campaign.attemptIds.includes(command.attemptId)) {
    throw new Error('WISERR_SUBMISSION_CAMPAIGN_ATTEMPT_MISMATCH');
  }
  if (
    campaign.plan?.planId !== command.planId ||
    campaign.plan?.approvalHash !== command.planApprovalHash ||
    campaign.approval?.approvalId !== command.campaignApprovalId
  ) {
    throw new Error('WISERR_SUBMISSION_CAMPAIGN_AUTHORITY_MISMATCH');
  }
}

export async function preparePersistedWiserrReactivationSubmission({
  store,
  tenantId,
  campaignId,
  commandId,
  now = new Date()
}) {
  requiredString(tenantId, 'tenantId');
  requiredString(campaignId, 'campaignId');
  requiredString(commandId, 'commandId');

  const commandRecord = await loadDurableWiserrReactivationCommand({ store, tenantId, commandId });
  if (!commandRecord) throw new Error('WISERR_SUBMISSION_COMMAND_NOT_FOUND');
  const command = clone(commandRecord.payload.command);
  if (command.campaignId !== campaignId) throw new Error('WISERR_SUBMISSION_COMMAND_CAMPAIGN_MISMATCH');

  let campaignRecord = await loadDurableReactivationCampaign({ store, tenantId, campaignId });
  if (!campaignRecord) throw new Error('WISERR_SUBMISSION_CAMPAIGN_NOT_FOUND');

  const attemptRecord = await loadDurableExecutionAttempt({ store, tenantId, attemptId: command.attemptId });
  if (!attemptRecord) throw new Error('WISERR_SUBMISSION_ATTEMPT_NOT_FOUND');
  assertCommandAttemptIdentity(command, attemptRecord.payload);

  if (attemptRecord.payload.state !== EXECUTION_ATTEMPT_STATES.CREATED) {
    const error = new Error(`WISERR_SUBMISSION_REPLAY_REFUSED:${attemptRecord.payload.state}`);
    error.requiresReconciliation = [
      EXECUTION_ATTEMPT_STATES.SUBMITTING,
      EXECUTION_ATTEMPT_STATES.ACCEPTED,
      EXECUTION_ATTEMPT_STATES.RECONCILIATION_REQUIRED
    ].includes(attemptRecord.payload.state);
    throw error;
  }

  if (campaignRecord.payload.status === 'APPROVED') {
    campaignRecord = await startDurableReactivationCampaignFromPersistedCommand({
      store,
      tenantId,
      campaignId,
      commandId,
      now
    });
  } else if (campaignRecord.payload.status === 'EXECUTING') {
    assertExecutingCampaignMatchesCommand(campaignRecord.payload, command);
  } else {
    throw new Error(`WISERR_SUBMISSION_CAMPAIGN_NOT_PREPARABLE:${campaignRecord.payload.status}`);
  }

  const submittingAttempt = await markDurableExecutionSubmitting({
    store,
    tenantId,
    attemptId: command.attemptId,
    now
  });

  return {
    schemaVersion: 1,
    tenantId,
    campaignId,
    commandId,
    attemptId: command.attemptId,
    attemptState: submittingAttempt.payload.state,
    campaignState: campaignRecord.payload.status,
    submissionAuthorized: true,
    command
  };
}
