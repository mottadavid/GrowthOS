import { sha256Canonical } from '../core/canonical.mjs';
import { reactivationPlanApprovalHash } from './plan.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function nonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number.`);
  return value;
}

export function buildReactivationPolicyAction({
  plan,
  campaignApproval,
  actionId,
  requestedBy,
  experimentId,
  accountId,
  geography,
  expectedSpendUsd = 0,
  currentTotalSpendUsd = 0,
  currentDailySpendUsd = 0,
  changePercent = 0,
  requestedAt = new Date()
}) {
  if (!plan || typeof plan !== 'object') throw new Error('plan is required.');
  if (!campaignApproval || typeof campaignApproval !== 'object') throw new Error('campaignApproval is required.');
  const planHash = reactivationPlanApprovalHash(plan);
  if (planHash !== plan.approvalHash) throw new Error('REACTIVATION_PLAN_HASH_INVALID');
  if (campaignApproval.approvedPlanHash !== planHash) throw new Error('CAMPAIGN_APPROVAL_PLAN_HASH_MISMATCH');

  const requestedAtIso = requestedAt instanceof Date ? requestedAt.toISOString() : new Date(requestedAt).toISOString();
  if (!Number.isFinite(Date.parse(requestedAtIso))) throw new Error('requestedAt must be a valid date/time.');

  return {
    schemaVersion: 1,
    actionId: requiredString(actionId, 'actionId'),
    tenantId: requiredString(plan.tenantId, 'plan.tenantId'),
    actionFamily: 'REACTIVATION',
    actionType: 'SEND_REACTIVATION_SEQUENCE',
    channel: requiredString(plan.channel, 'plan.channel'),
    accountId: requiredString(accountId, 'accountId'),
    geography: requiredString(geography, 'geography'),
    requestedAt: requestedAtIso,
    requestedBy: requiredString(requestedBy, 'requestedBy'),
    businessSnapshotId: requiredString(plan.businessSnapshotId, 'plan.businessSnapshotId'),
    opportunityId: requiredString(plan.opportunityId, 'plan.opportunityId'),
    experimentId: requiredString(experimentId, 'experimentId'),
    inputs: {
      demandIncreasing: true,
      planId: requiredString(plan.planId, 'plan.planId'),
      planApprovalHash: planHash,
      campaignApprovalId: requiredString(campaignApproval.approvalId, 'campaignApproval.approvalId'),
      cohortDefinitionId: requiredString(plan.cohort?.definitionId, 'plan.cohort.definitionId'),
      cohortDefinitionVersion: requiredString(plan.cohort?.definitionVersion, 'plan.cohort.definitionVersion'),
      messageVersion: requiredString(plan.message?.version, 'plan.message.version'),
      messageHash: sha256Canonical(plan.message),
      increasesTotalBudget: false,
      changesPublicPrice: false,
      createsGuarantee: false,
      materialDiscount: false
    },
    expectedCost: {
      spendUsd: nonNegative(expectedSpendUsd, 'expectedSpendUsd'),
      recipients: plan.cohort.plannedMaxRecipients
    },
    currentTotalSpendUsd: nonNegative(currentTotalSpendUsd, 'currentTotalSpendUsd'),
    currentDailySpendUsd: nonNegative(currentDailySpendUsd, 'currentDailySpendUsd'),
    changePercent: nonNegative(changePercent, 'changePercent'),
    attemptNumber: plan.execution.attemptNumber,
    approvalId: campaignApproval.approvalId
  };
}
