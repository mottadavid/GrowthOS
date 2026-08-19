import { actionApprovalHash, sha256Canonical } from '../core/canonical.mjs';
import { assertPolicyReceiptMatches } from '../core/policy-receipts.mjs';
import { EXECUTION_ATTEMPT_STATES } from '../core/execution-attempts.mjs';
import { assertExperimentIntegrity } from '../core/experiments.mjs';
import { evaluateReactivationCampaignStart, CAMPAIGN_START_DECISIONS } from './campaign.mjs';
import { reactivationPlanApprovalHash } from './plan.mjs';
import {
  WISERR_REACTIVATION_SMS_DEPENDENCY_ID,
  assertWiserrReactivationSmsExecutionAuthorityReady
} from '../integrations/wiserr/reactivation-sms-authority.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function commandBody(command) {
  const { commandHash, ...body } = command;
  return body;
}

export function wiserrReactivationCommandHash(command) {
  return sha256Canonical(commandBody(command));
}

export function buildWiserrReactivationCommand({
  campaign,
  experiment,
  action,
  envelope,
  policyReceipt,
  attempt,
  currentSnapshot,
  executionAuthorityDecision,
  now = new Date()
}) {
  if (!campaign || typeof campaign !== 'object') throw new Error('campaign is required.');
  if (!experiment || typeof experiment !== 'object') throw new Error('experiment is required.');
  if (!action || typeof action !== 'object') throw new Error('action is required.');
  if (!envelope || typeof envelope !== 'object') throw new Error('envelope is required.');
  if (!attempt || typeof attempt !== 'object') throw new Error('attempt is required.');

  const plan = campaign.plan;
  if (!plan || typeof plan !== 'object') throw new Error('campaign.plan is required.');
  if (campaign.status !== 'APPROVED') throw new Error('REACTIVATION_CAMPAIGN_NOT_APPROVED');
  if (!campaign.approval) throw new Error('REACTIVATION_CAMPAIGN_APPROVAL_MISSING');

  const planHash = reactivationPlanApprovalHash(plan);
  if (planHash !== plan.approvalHash || planHash !== campaign.approval.approvedPlanHash) {
    throw new Error('REACTIVATION_CAMPAIGN_PLAN_INTEGRITY_FAILED');
  }

  assertExperimentIntegrity(experiment);
  if (!['APPROVED', 'RUNNING'].includes(experiment.state)) throw new Error('REACTIVATION_EXPERIMENT_NOT_EXECUTABLE');
  if (experiment.tenantId !== campaign.tenantId) throw new Error('REACTIVATION_EXPERIMENT_TENANT_MISMATCH');
  if (experiment.experimentId !== action.experimentId) throw new Error('REACTIVATION_EXPERIMENT_ACTION_MISMATCH');
  if (experiment.actionPlanRef !== plan.planId || experiment.actionPlanHash !== planHash) {
    throw new Error('REACTIVATION_EXPERIMENT_PLAN_MISMATCH');
  }

  if (action.tenantId !== campaign.tenantId) throw new Error('REACTIVATION_ACTION_TENANT_MISMATCH');
  if (action.opportunityId !== plan.opportunityId) throw new Error('REACTIVATION_ACTION_OPPORTUNITY_MISMATCH');
  if (action.businessSnapshotId !== plan.businessSnapshotId) throw new Error('REACTIVATION_ACTION_SNAPSHOT_MISMATCH');
  if (action.inputs?.planId !== plan.planId || action.inputs?.planApprovalHash !== planHash) {
    throw new Error('REACTIVATION_ACTION_PLAN_MISMATCH');
  }
  if (action.inputs?.campaignApprovalId !== campaign.approval.approvalId) {
    throw new Error('REACTIVATION_ACTION_CAMPAIGN_APPROVAL_MISMATCH');
  }
  if (action.inputs?.messageHash !== sha256Canonical(plan.message)) throw new Error('REACTIVATION_ACTION_MESSAGE_MISMATCH');

  assertPolicyReceiptMatches({ receipt: policyReceipt, action, envelope });
  if (policyReceipt.decision !== 'ALLOW') throw new Error('REACTIVATION_POLICY_NOT_ALLOWED');

  assertWiserrReactivationSmsExecutionAuthorityReady(executionAuthorityDecision);

  const actionHash = actionApprovalHash(action);
  if (attempt.state !== EXECUTION_ATTEMPT_STATES.CREATED) throw new Error('REACTIVATION_ATTEMPT_NOT_CREATED');
  if (attempt.tenantId !== action.tenantId || attempt.actionId !== action.actionId || attempt.actionHash !== actionHash) {
    throw new Error('REACTIVATION_ATTEMPT_ACTION_MISMATCH');
  }
  if (attempt.attemptNumber !== action.attemptNumber) throw new Error('REACTIVATION_ATTEMPT_NUMBER_MISMATCH');

  const start = evaluateReactivationCampaignStart({ campaign, currentSnapshot, executionAuthorityDecision, now });
  if (start.decision !== CAMPAIGN_START_DECISIONS.READY) {
    const error = new Error(`REACTIVATION_NOT_READY_FOR_WISERR:${start.decision}:${start.reasons.join(',')}`);
    error.startDecision = start;
    throw error;
  }

  if (!Number.isInteger(start.dispatchMaxRecipients) || start.dispatchMaxRecipients < 1) {
    throw new Error('REACTIVATION_DISPATCH_CEILING_INVALID');
  }
  if (start.dispatchMaxRecipients > plan.cohort.plannedMaxRecipients) {
    throw new Error('REACTIVATION_DISPATCH_EXCEEDS_APPROVED_PLAN');
  }

  const command = {
    schemaVersion: 1,
    commandId: `wiserr-reactivation:${action.tenantId}:${action.actionId}:attempt:${attempt.attemptNumber}`,
    tenantId: action.tenantId,
    actionId: action.actionId,
    actionHash,
    campaignId: campaign.campaignId,
    opportunityId: action.opportunityId,
    experimentId: experiment.experimentId,
    planId: plan.planId,
    planApprovalHash: planHash,
    campaignApprovalId: campaign.approval.approvalId,
    policyReceiptId: policyReceipt.receiptId,
    policyReceiptHash: policyReceipt.receiptHash,
    envelopeId: envelope.envelopeId,
    envelopeHash: policyReceipt.envelopeHash,
    attemptId: attempt.attemptId,
    attemptNumber: attempt.attemptNumber,
    idempotencyKey: attempt.idempotencyKey,
    executionAuthorityDependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID,
    executionAuthorityLockFingerprint: requiredString(
      executionAuthorityDecision.metadata?.lockFingerprint,
      'executionAuthorityDecision.metadata.lockFingerprint'
    ),
    originalBusinessSnapshotId: plan.businessSnapshotId,
    executionBusinessSnapshotId: requiredString(start.currentSnapshotId, 'start.currentSnapshotId'),
    cohortDefinitionId: plan.cohort.definitionId,
    cohortDefinitionVersion: plan.cohort.definitionVersion,
    channel: plan.channel,
    accountId: action.accountId,
    geography: action.geography,
    maxRecipients: start.dispatchMaxRecipients,
    message: structuredClone(plan.message),
    frequencyPolicy: structuredClone(plan.frequencyPolicy)
  };

  return {
    ...command,
    commandHash: sha256Canonical(command)
  };
}

export function validateWiserrReactivationCommand(command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new Error('command must be an object.');
  if (command.schemaVersion !== 1) throw new Error('Unsupported command.schemaVersion.');
  for (const field of [
    'commandId', 'tenantId', 'actionId', 'actionHash', 'campaignId', 'opportunityId', 'experimentId',
    'planId', 'planApprovalHash', 'campaignApprovalId', 'policyReceiptId', 'policyReceiptHash',
    'envelopeId', 'envelopeHash', 'attemptId', 'idempotencyKey', 'executionAuthorityDependencyId',
    'executionAuthorityLockFingerprint', 'originalBusinessSnapshotId', 'executionBusinessSnapshotId',
    'cohortDefinitionId', 'cohortDefinitionVersion', 'channel', 'accountId', 'geography', 'commandHash'
  ]) requiredString(command[field], `command.${field}`);
  if (command.executionAuthorityDependencyId !== WISERR_REACTIVATION_SMS_DEPENDENCY_ID) {
    throw new Error('WISERR_REACTIVATION_COMMAND_EXECUTION_AUTHORITY_MISMATCH');
  }
  if (!Number.isInteger(command.attemptNumber) || command.attemptNumber < 1) throw new Error('command.attemptNumber must be positive.');
  if (!Number.isInteger(command.maxRecipients) || command.maxRecipients < 1) throw new Error('command.maxRecipients must be positive.');
  if (!command.message || typeof command.message !== 'object') throw new Error('command.message is required.');
  if (!command.frequencyPolicy || typeof command.frequencyPolicy !== 'object') throw new Error('command.frequencyPolicy is required.');
  for (const field of [
    'actionHash', 'planApprovalHash', 'policyReceiptHash', 'envelopeHash',
    'executionAuthorityLockFingerprint', 'commandHash'
  ]) {
    if (!/^[0-9a-f]{64}$/.test(command[field])) throw new Error(`command.${field} must be SHA-256 hex.`);
  }
  if (wiserrReactivationCommandHash(command) !== command.commandHash) throw new Error('WISERR_REACTIVATION_COMMAND_HASH_MISMATCH');
  return command;
}
