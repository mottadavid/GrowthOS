import { reactivationPlanApprovalHash } from './plan.mjs';
import { channelReadiness, validateWiserrGrowthSnapshot } from '../integrations/wiserr/growth-snapshot.mjs';
import { UPSTREAM_AUTHORITY_DECISIONS } from '../core/upstream-authority.mjs';

export const REACTIVATION_CAMPAIGN_STATES = Object.freeze([
  'DRAFT',
  'READY_FOR_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'OBSERVING',
  'COMPLETED',
  'STOPPED',
  'FAILED',
  'RECONCILIATION_REQUIRED'
]);

export const CAMPAIGN_START_DECISIONS = Object.freeze({
  READY: 'READY',
  REQUIRE_REAPPROVAL: 'REQUIRE_REAPPROVAL',
  DENY: 'DENY',
  NO_ACTION: 'NO_ACTION'
});

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function iso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date/time.`);
  return date.toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function assertState(campaign, allowed, operation) {
  if (!allowed.includes(campaign.status)) {
    throw new Error(`${operation} not allowed from campaign state ${campaign.status}.`);
  }
}

export function createReactivationCampaign(plan, { campaignId = null, now = new Date() } = {}) {
  if (!plan || typeof plan !== 'object') throw new Error('plan is required.');
  requiredString(plan.planId, 'plan.planId');
  requiredString(plan.tenantId, 'plan.tenantId');
  requiredString(plan.approvalHash, 'plan.approvalHash');
  const currentHash = reactivationPlanApprovalHash(plan);
  if (currentHash !== plan.approvalHash) throw new Error('REACTIVATION_PLAN_HASH_INVALID');
  const timestamp = iso(now, 'now');
  return {
    schemaVersion: 1,
    campaignId: campaignId || `campaign-${plan.planId}`,
    tenantId: plan.tenantId,
    status: 'DRAFT',
    plan: clone(plan),
    approval: null,
    attemptIds: [],
    observationStartedAt: null,
    completedAt: null,
    stopReason: null,
    failureReason: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function submitReactivationCampaignForApproval(campaign, { now = new Date() } = {}) {
  assertState(campaign, ['DRAFT'], 'submit for approval');
  return { ...clone(campaign), status: 'READY_FOR_APPROVAL', updatedAt: iso(now, 'now') };
}

export function approveReactivationCampaign(campaign, {
  approvalId,
  approvedBy,
  approvedPlanHash,
  approvedAt = new Date(),
  expiresAt = null
}) {
  assertState(campaign, ['READY_FOR_APPROVAL'], 'approve');
  requiredString(approvalId, 'approvalId');
  requiredString(approvedBy, 'approvedBy');
  requiredString(approvedPlanHash, 'approvedPlanHash');
  const currentHash = reactivationPlanApprovalHash(campaign.plan);
  if (approvedPlanHash !== currentHash || approvedPlanHash !== campaign.plan.approvalHash) {
    throw new Error('APPROVAL_PLAN_HASH_MISMATCH');
  }
  const approvedAtIso = iso(approvedAt, 'approvedAt');
  const expiresAtIso = expiresAt === null ? null : iso(expiresAt, 'expiresAt');
  if (expiresAtIso && Date.parse(expiresAtIso) <= Date.parse(approvedAtIso)) throw new Error('expiresAt must be after approvedAt.');
  return {
    ...clone(campaign),
    status: 'APPROVED',
    approval: {
      approvalId,
      approvedBy,
      approvedAt: approvedAtIso,
      approvedPlanHash,
      expiresAt: expiresAtIso
    },
    updatedAt: approvedAtIso
  };
}

export function assertCampaignPlanIntegrity(campaign) {
  if (!campaign.approval) throw new Error('CAMPAIGN_NOT_APPROVED');
  const currentHash = reactivationPlanApprovalHash(campaign.plan);
  if (currentHash !== campaign.approval.approvedPlanHash || currentHash !== campaign.plan.approvalHash) {
    throw new Error('APPROVED_CAMPAIGN_PLAN_CHANGED');
  }
  return true;
}

export function evaluateReactivationCampaignStart({
  campaign,
  currentSnapshot,
  upstreamDecision,
  now = new Date()
}) {
  if (campaign.status !== 'APPROVED') {
    return { decision: CAMPAIGN_START_DECISIONS.DENY, reasons: ['CAMPAIGN_NOT_APPROVED'] };
  }

  try {
    assertCampaignPlanIntegrity(campaign);
  } catch (error) {
    return { decision: CAMPAIGN_START_DECISIONS.REQUIRE_REAPPROVAL, reasons: [error.message] };
  }

  const nowIso = iso(now, 'now');
  if (campaign.approval.expiresAt && Date.parse(nowIso) > Date.parse(campaign.approval.expiresAt)) {
    return { decision: CAMPAIGN_START_DECISIONS.REQUIRE_REAPPROVAL, reasons: ['CAMPAIGN_APPROVAL_EXPIRED'] };
  }

  if (!upstreamDecision || upstreamDecision.decision !== UPSTREAM_AUTHORITY_DECISIONS.READY) {
    return {
      decision: CAMPAIGN_START_DECISIONS.DENY,
      reasons: ['UPSTREAM_AUTHORITY_NOT_READY', ...(upstreamDecision?.reasons || [])]
    };
  }

  validateWiserrGrowthSnapshot(currentSnapshot);
  if (currentSnapshot.tenantId !== campaign.tenantId) {
    return { decision: CAMPAIGN_START_DECISIONS.DENY, reasons: ['CURRENT_SNAPSHOT_TENANT_MISMATCH'] };
  }
  if (currentSnapshot.completeness !== 'COMPLETE_FOR_PURPOSE') {
    return { decision: CAMPAIGN_START_DECISIONS.NO_ACTION, reasons: ['CURRENT_BUSINESS_STATE_INCOMPLETE'] };
  }
  if (currentSnapshot.capacity.status !== 'AVAILABLE' || currentSnapshot.capacity.demandThrottleRecommended === true) {
    return {
      decision: CAMPAIGN_START_DECISIONS.NO_ACTION,
      reasons: [`CURRENT_CAPACITY_${currentSnapshot.capacity.status}`]
    };
  }

  if (
    currentSnapshot.reactivation.cohortDefinitionId !== campaign.plan.cohort.definitionId ||
    currentSnapshot.reactivation.cohortDefinitionVersion !== campaign.plan.cohort.definitionVersion
  ) {
    return { decision: CAMPAIGN_START_DECISIONS.REQUIRE_REAPPROVAL, reasons: ['COHORT_DEFINITION_CHANGED'] };
  }

  const readiness = channelReadiness(currentSnapshot, campaign.plan.channel);
  if (!readiness.capabilityEnabled) {
    return { decision: CAMPAIGN_START_DECISIONS.DENY, reasons: [`CURRENT_CAPABILITY_DISABLED:${readiness.capability}`] };
  }
  if (readiness.eligibleRecipients < 1) {
    return { decision: CAMPAIGN_START_DECISIONS.NO_ACTION, reasons: ['NO_CURRENTLY_ELIGIBLE_RECIPIENTS'] };
  }

  return {
    decision: CAMPAIGN_START_DECISIONS.READY,
    reasons: ['CAMPAIGN_REVALIDATED_FOR_EXECUTION'],
    dispatchMaxRecipients: Math.min(campaign.plan.cohort.plannedMaxRecipients, readiness.eligibleRecipients),
    currentSnapshotId: currentSnapshot.snapshotId,
    currentEligibleRecipients: readiness.eligibleRecipients
  };
}

export function startReactivationCampaign(campaign, { attemptId, now = new Date() } = {}) {
  assertState(campaign, ['APPROVED'], 'start');
  assertCampaignPlanIntegrity(campaign);
  requiredString(attemptId, 'attemptId');
  if (campaign.attemptIds.includes(attemptId)) throw new Error('DUPLICATE_CAMPAIGN_ATTEMPT_ID');
  return {
    ...clone(campaign),
    status: 'EXECUTING',
    attemptIds: [...campaign.attemptIds, attemptId],
    updatedAt: iso(now, 'now')
  };
}

export function markReactivationCampaignObserving(campaign, { now = new Date() } = {}) {
  assertState(campaign, ['EXECUTING'], 'mark observing');
  const timestamp = iso(now, 'now');
  return {
    ...clone(campaign),
    status: 'OBSERVING',
    observationStartedAt: timestamp,
    updatedAt: timestamp
  };
}

export function markReactivationCampaignReconciliationRequired(campaign, { reason, now = new Date() } = {}) {
  assertState(campaign, ['EXECUTING'], 'mark reconciliation required');
  requiredString(reason, 'reason');
  return {
    ...clone(campaign),
    status: 'RECONCILIATION_REQUIRED',
    failureReason: reason,
    updatedAt: iso(now, 'now')
  };
}

export function stopReactivationCampaign(campaign, { reason, now = new Date() } = {}) {
  assertState(campaign, ['APPROVED', 'EXECUTING', 'OBSERVING', 'RECONCILIATION_REQUIRED'], 'stop');
  requiredString(reason, 'reason');
  return {
    ...clone(campaign),
    status: 'STOPPED',
    stopReason: reason,
    updatedAt: iso(now, 'now')
  };
}

export function failReactivationCampaign(campaign, { reason, now = new Date() } = {}) {
  assertState(campaign, ['EXECUTING', 'RECONCILIATION_REQUIRED'], 'fail');
  requiredString(reason, 'reason');
  return {
    ...clone(campaign),
    status: 'FAILED',
    failureReason: reason,
    updatedAt: iso(now, 'now')
  };
}

export function completeReactivationCampaign(campaign, { now = new Date() } = {}) {
  assertState(campaign, ['OBSERVING'], 'complete');
  const timestamp = iso(now, 'now');
  return {
    ...clone(campaign),
    status: 'COMPLETED',
    completedAt: timestamp,
    updatedAt: timestamp
  };
}
