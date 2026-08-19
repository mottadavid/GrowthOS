import { sha256Canonical } from '../core/canonical.mjs';
import { channelEligibility, validateWiserrGrowthSnapshot } from '../integrations/wiserr/growth-snapshot.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

export function approvalBoundReactivationPlan(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    tenantId: plan.tenantId,
    opportunityId: plan.opportunityId,
    businessSnapshotId: plan.businessSnapshotId,
    cohort: plan.cohort,
    channel: plan.channel,
    message: plan.message,
    successMetric: plan.successMetric,
    observationHorizonHours: plan.observationHorizonHours,
    frequencyPolicy: plan.frequencyPolicy,
    execution: plan.execution
  };
}

export function reactivationPlanApprovalHash(plan) {
  return sha256Canonical(approvalBoundReactivationPlan(plan));
}

export function buildReactivationPlan({
  opportunity,
  snapshot,
  channel,
  message,
  requestedMaxRecipients,
  successMetric = 'BOOKING',
  observationHorizonHours = 168,
  maxAttempts = 1,
  minHoursBetweenAttempts = 24
}) {
  if (!opportunity || typeof opportunity !== 'object') throw new Error('opportunity is required.');
  validateWiserrGrowthSnapshot(snapshot);
  requiredString(opportunity.opportunityId, 'opportunity.opportunityId');
  requiredString(opportunity.tenantId, 'opportunity.tenantId');
  requiredString(opportunity.businessSnapshotId, 'opportunity.businessSnapshotId');
  if (opportunity.type !== 'DORMANT_LEAD_REACTIVATION') throw new Error('Unsupported opportunity type for reactivation plan.');
  if (opportunity.tenantId !== snapshot.tenantId) throw new Error('Opportunity tenant does not match snapshot tenant.');
  if (opportunity.businessSnapshotId !== snapshot.snapshotId) throw new Error('Opportunity snapshot does not match current Wiserr snapshot.');

  const eligibility = channelEligibility(snapshot, channel);
  if (eligibility.eligibleRecipients < 1) throw new Error(`No currently eligible ${channel} recipients exist for this cohort.`);

  if (!message || typeof message !== 'object') throw new Error('message is required.');
  requiredString(message.strategy, 'message.strategy');
  requiredString(message.body, 'message.body');
  requiredString(message.version, 'message.version');

  positiveInteger(requestedMaxRecipients, 'requestedMaxRecipients');
  positiveInteger(observationHorizonHours, 'observationHorizonHours');
  positiveInteger(maxAttempts, 'maxAttempts');
  if (!Number.isInteger(minHoursBetweenAttempts) || minHoursBetweenAttempts < 0) {
    throw new Error('minHoursBetweenAttempts must be a non-negative integer.');
  }
  if (!['QUALIFIED_REPLY', 'BOOKING', 'WON_CUSTOMER'].includes(successMetric)) throw new Error('Invalid successMetric.');

  const plannedMaxRecipients = Math.min(requestedMaxRecipients, eligibility.eligibleRecipients);
  const planId = `plan-${opportunity.opportunityId}-${channel}`;
  const plan = {
    schemaVersion: 1,
    planId,
    tenantId: opportunity.tenantId,
    opportunityId: opportunity.opportunityId,
    businessSnapshotId: snapshot.snapshotId,
    cohort: {
      definitionId: snapshot.reactivation.cohortDefinitionId,
      definitionVersion: snapshot.reactivation.cohortDefinitionVersion,
      plannedMaxRecipients
    },
    channel,
    message: {
      strategy: message.strategy,
      body: message.body,
      version: message.version,
      offerId: message.offerId ?? null
    },
    successMetric,
    observationHorizonHours,
    frequencyPolicy: {
      maxAttempts,
      minHoursBetweenAttempts,
      stopOnReply: true,
      stopOnBooking: true,
      stopOnOptOut: true
    },
    execution: {
      authority: 'WISERR',
      requiresCapability: eligibility.capability,
      attemptNumber: 1
    }
  };

  return {
    ...plan,
    approvalHash: reactivationPlanApprovalHash(plan)
  };
}

export function assertApprovedReactivationPlan(plan, approvalHash) {
  requiredString(approvalHash, 'approvalHash');
  const current = reactivationPlanApprovalHash(plan);
  if (current !== approvalHash) throw new Error('APPROVED_REACTIVATION_PLAN_CHANGED');
  return true;
}

export function buildWiserrReactivationExecutionRequest({ plan, approvalHash, actionId, experimentId = null }) {
  assertApprovedReactivationPlan(plan, approvalHash);
  requiredString(actionId, 'actionId');
  return {
    schemaVersion: 1,
    actionId,
    tenantId: plan.tenantId,
    opportunityId: plan.opportunityId,
    experimentId,
    businessSnapshotId: plan.businessSnapshotId,
    planId: plan.planId,
    planApprovalHash: approvalHash,
    cohortDefinitionId: plan.cohort.definitionId,
    cohortDefinitionVersion: plan.cohort.definitionVersion,
    channel: plan.channel,
    maxRecipients: plan.cohort.plannedMaxRecipients,
    message: plan.message,
    frequencyPolicy: plan.frequencyPolicy,
    attemptNumber: plan.execution.attemptNumber,
    idempotencyKey: `growthos:${plan.tenantId}:${actionId}:attempt:${plan.execution.attemptNumber}`
  };
}
