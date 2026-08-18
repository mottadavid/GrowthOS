import {
  REACTIVATION_CAMPAIGN_STATES,
  createReactivationCampaign,
  submitReactivationCampaignForApproval,
  approveReactivationCampaign,
  assertCampaignPlanIntegrity,
  startReactivationCampaign,
  markReactivationCampaignObserving,
  markReactivationCampaignReconciliationRequired,
  stopReactivationCampaign,
  failReactivationCampaign,
  completeReactivationCampaign
} from '../reactivation/campaign.mjs';
import { reactivationPlanApprovalHash } from '../reactivation/plan.mjs';
import { validateWiserrReactivationCommand } from '../reactivation/wiserr-command.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const REACTIVATION_CAMPAIGN_RECORD_TYPE = 'reactivation_campaign';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function validateCampaignPayload(campaign) {
  if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign)) throw new Error('campaign payload must be an object.');
  requiredString(campaign.campaignId, 'campaign.campaignId');
  requiredString(campaign.tenantId, 'campaign.tenantId');
  if (!REACTIVATION_CAMPAIGN_STATES.includes(campaign.status)) throw new Error('Invalid campaign.status.');
  if (!campaign.plan || typeof campaign.plan !== 'object') throw new Error('campaign.plan is required.');
  requiredString(campaign.plan.planId, 'campaign.plan.planId');
  requiredString(campaign.plan.approvalHash, 'campaign.plan.approvalHash');
  const planHash = reactivationPlanApprovalHash(campaign.plan);
  if (planHash !== campaign.plan.approvalHash) throw new Error('DURABLE_REACTIVATION_PLAN_HASH_INVALID');
  if (campaign.approval) assertCampaignPlanIntegrity(campaign);
  return campaign;
}

function validateCampaignRecord(record, tenantId) {
  validateCampaignPayload(record.payload);
  if (
    record.tenantId !== tenantId ||
    record.payload.tenantId !== tenantId ||
    record.recordId !== record.payload.campaignId ||
    record.indexKey !== record.payload.plan.approvalHash
  ) {
    throw new Error('DURABLE_REACTIVATION_CAMPAIGN_IDENTITY_MISMATCH');
  }
  return record;
}

export function durableCampaignIdForPlan(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('plan is required.');
  requiredString(plan.planId, 'plan.planId');
  requiredString(plan.approvalHash, 'plan.approvalHash');
  const currentHash = reactivationPlanApprovalHash(plan);
  if (currentHash !== plan.approvalHash) throw new Error('REACTIVATION_PLAN_HASH_INVALID');
  return `campaign-${plan.planId}-${plan.approvalHash.slice(0, 16)}`;
}

function eventIdFor(campaign, revision) {
  return `reactivation-campaign:${campaign.campaignId}:revision:${revision}:${campaign.status}`;
}

function eventTypeFor(campaign) {
  return `growth.reactivation_campaign.${String(campaign.status).toLowerCase()}`;
}

function eventPayload(campaign, extra = {}) {
  return {
    campaignId: campaign.campaignId,
    planId: campaign.plan.planId,
    planApprovalHash: campaign.plan.approvalHash,
    opportunityId: campaign.plan.opportunityId,
    status: campaign.status,
    approvalId: campaign.approval?.approvalId ?? null,
    attemptCount: Array.isArray(campaign.attemptIds) ? campaign.attemptIds.length : 0,
    ...clone(extra)
  };
}

export async function loadDurableReactivationCampaign({ store, tenantId, campaignId }) {
  requiredString(tenantId, 'tenantId');
  requiredString(campaignId, 'campaignId');
  const record = await store.getRecord({
    tenantId,
    recordType: REACTIVATION_CAMPAIGN_RECORD_TYPE,
    recordId: campaignId
  });
  if (!record) return null;
  return validateCampaignRecord(record, tenantId);
}

export async function listDurableReactivationCampaigns({ store, tenantId, planApprovalHash = null, limit = 1000 }) {
  requiredString(tenantId, 'tenantId');
  if (planApprovalHash !== null) requiredString(planApprovalHash, 'planApprovalHash');
  const records = await store.listRecords({
    tenantId,
    recordType: REACTIVATION_CAMPAIGN_RECORD_TYPE,
    indexKey: planApprovalHash,
    limit
  });
  return records.map(record => validateCampaignRecord(record, tenantId));
}

export async function createDurableReactivationCampaign({ store, plan, now = new Date() }) {
  if (!plan || typeof plan !== 'object') throw new Error('plan is required.');
  const campaignId = durableCampaignIdForPlan(plan);
  const existing = await loadDurableReactivationCampaign({ store, tenantId: plan.tenantId, campaignId });
  if (existing) {
    if (existing.indexKey !== plan.approvalHash) throw new Error('DURABLE_REACTIVATION_CAMPAIGN_IDENTITY_MISMATCH');
    return { record: existing, idempotent: true };
  }

  const campaign = createReactivationCampaign(plan, { campaignId, now });
  validateCampaignPayload(campaign);
  try {
    const result = await mutateAuthoritativeRuntimeState({
      store,
      tenantId: campaign.tenantId,
      recordType: REACTIVATION_CAMPAIGN_RECORD_TYPE,
      recordId: campaign.campaignId,
      indexKey: campaign.plan.approvalHash,
      payload: campaign,
      expectedRevision: 0,
      now,
      event: {
        eventId: eventIdFor(campaign, 1),
        eventType: eventTypeFor(campaign),
        payload: eventPayload(campaign),
        correlationId: campaign.campaignId
      }
    });
    return { record: validateCampaignRecord(result.record, campaign.tenantId), idempotent: false };
  } catch (error) {
    if (error?.code !== 'RUNTIME_RECORD_REVISION_CONFLICT') throw error;
    const raced = await loadDurableReactivationCampaign({ store, tenantId: campaign.tenantId, campaignId });
    if (!raced || raced.indexKey !== plan.approvalHash) throw error;
    return { record: raced, idempotent: true };
  }
}

async function transition({ store, tenantId, campaignId, now = new Date(), apply, eventExtra = {} }) {
  const current = await loadDurableReactivationCampaign({ store, tenantId, campaignId });
  if (!current) throw new Error('DURABLE_REACTIVATION_CAMPAIGN_NOT_FOUND');
  const next = apply(clone(current.payload));
  validateCampaignPayload(next);
  if (
    next.campaignId !== current.payload.campaignId ||
    next.tenantId !== current.payload.tenantId ||
    next.plan.approvalHash !== current.payload.plan.approvalHash
  ) {
    throw new Error('DURABLE_REACTIVATION_CAMPAIGN_IDENTITY_CHANGED');
  }
  const nextRevision = current.revision + 1;
  const result = await mutateAuthoritativeRuntimeState({
    store,
    tenantId,
    recordType: REACTIVATION_CAMPAIGN_RECORD_TYPE,
    recordId: campaignId,
    indexKey: next.plan.approvalHash,
    payload: next,
    expectedRevision: current.revision,
    now,
    event: {
      eventId: eventIdFor(next, nextRevision),
      eventType: eventTypeFor(next),
      payload: eventPayload(next, eventExtra),
      correlationId: campaignId
    }
  });
  return validateCampaignRecord(result.record, tenantId);
}

export function submitDurableReactivationCampaignForApproval({ store, tenantId, campaignId, now = new Date() }) {
  return transition({
    store, tenantId, campaignId, now,
    apply: campaign => submitReactivationCampaignForApproval(campaign, { now })
  });
}

export function approveDurableReactivationCampaign({
  store,
  tenantId,
  campaignId,
  approvalId,
  approvedBy,
  approvedPlanHash,
  approvalAuthorityRef,
  approvedAt = new Date(),
  expiresAt = null
}) {
  requiredString(approvalAuthorityRef, 'approvalAuthorityRef');
  return transition({
    store,
    tenantId,
    campaignId,
    now: approvedAt,
    apply: campaign => approveReactivationCampaign(campaign, {
      approvalId,
      approvedBy,
      approvedPlanHash,
      approvalAuthorityRef,
      approvedAt,
      expiresAt
    }),
    eventExtra: { approvalAuthorityRef }
  });
}

export function startDurableReactivationCampaignFromCommand({ store, tenantId, campaignId, command, now = new Date() }) {
  validateWiserrReactivationCommand(command);
  if (command.tenantId !== tenantId || command.campaignId !== campaignId) {
    throw new Error('DURABLE_REACTIVATION_COMMAND_CAMPAIGN_MISMATCH');
  }
  return transition({
    store,
    tenantId,
    campaignId,
    now,
    apply: campaign => {
      if (campaign.plan.approvalHash !== command.planApprovalHash) throw new Error('DURABLE_REACTIVATION_COMMAND_PLAN_MISMATCH');
      if (campaign.approval?.approvalId !== command.campaignApprovalId) throw new Error('DURABLE_REACTIVATION_COMMAND_APPROVAL_MISMATCH');
      return startReactivationCampaign(campaign, { attemptId: command.attemptId, now });
    },
    eventExtra: {
      commandId: command.commandId,
      commandHash: command.commandHash,
      attemptId: command.attemptId,
      executionBusinessSnapshotId: command.executionBusinessSnapshotId,
      dispatchMaxRecipients: command.maxRecipients
    }
  });
}

export function markDurableReactivationCampaignObserving({ store, tenantId, campaignId, now = new Date() }) {
  return transition({
    store, tenantId, campaignId, now,
    apply: campaign => markReactivationCampaignObserving(campaign, { now })
  });
}

export function markDurableReactivationCampaignReconciliationRequired({ store, tenantId, campaignId, reason, now = new Date() }) {
  return transition({
    store, tenantId, campaignId, now,
    apply: campaign => markReactivationCampaignReconciliationRequired(campaign, { reason, now })
  });
}

export function stopDurableReactivationCampaign({ store, tenantId, campaignId, reason, now = new Date() }) {
  return transition({
    store, tenantId, campaignId, now,
    apply: campaign => stopReactivationCampaign(campaign, { reason, now })
  });
}

export function failDurableReactivationCampaign({ store, tenantId, campaignId, reason, now = new Date() }) {
  return transition({
    store, tenantId, campaignId, now,
    apply: campaign => failReactivationCampaign(campaign, { reason, now })
  });
}

export function completeDurableReactivationCampaign({ store, tenantId, campaignId, now = new Date() }) {
  return transition({
    store, tenantId, campaignId, now,
    apply: campaign => completeReactivationCampaign(campaign, { now })
  });
}
