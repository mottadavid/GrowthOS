import { actionApprovalHash, sha256Canonical } from './canonical.mjs';
import { envelopeAuthorityHash, assertPolicyReceiptMatches } from './policy-receipts.mjs';
import { experimentApprovalHash } from './experiments.mjs';
import { reactivationPlanApprovalHash } from '../reactivation/plan.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function manifestBody(manifest) {
  const { manifestHash, ...body } = manifest;
  return body;
}

export function growthRunManifestHash(manifest) {
  return sha256Canonical(manifestBody(manifest));
}

export function assertGrowthRunConsistency({
  runId,
  snapshot,
  opportunity,
  campaign,
  experiment,
  envelope,
  action,
  attempt,
  policyReceipt = null,
  outcomeEvents = []
}) {
  requiredString(runId, 'runId');
  for (const [label, value] of Object.entries({ snapshot, opportunity, campaign, experiment, envelope, action, attempt })) {
    if (!value || typeof value !== 'object') throw new Error(`${label} is required.`);
  }

  const tenantId = requiredString(snapshot.tenantId, 'snapshot.tenantId');
  const sameTenant = [opportunity, campaign, experiment, envelope, action, attempt].every((value) => value.tenantId === tenantId);
  if (!sameTenant) throw new Error('GROWTH_RUN_TENANT_MISMATCH');

  if (opportunity.businessSnapshotId !== snapshot.snapshotId) throw new Error('GROWTH_RUN_OPPORTUNITY_SNAPSHOT_MISMATCH');
  if (campaign.plan?.opportunityId !== opportunity.opportunityId) throw new Error('GROWTH_RUN_CAMPAIGN_OPPORTUNITY_MISMATCH');
  if (campaign.plan?.businessSnapshotId !== snapshot.snapshotId) throw new Error('GROWTH_RUN_CAMPAIGN_SNAPSHOT_MISMATCH');
  if (reactivationPlanApprovalHash(campaign.plan) !== campaign.plan.approvalHash) throw new Error('GROWTH_RUN_PLAN_HASH_INVALID');

  if (experiment.opportunityId !== opportunity.opportunityId) throw new Error('GROWTH_RUN_EXPERIMENT_OPPORTUNITY_MISMATCH');
  if (experiment.businessSnapshotId !== snapshot.snapshotId) throw new Error('GROWTH_RUN_EXPERIMENT_SNAPSHOT_MISMATCH');
  if (experiment.actionPlanRef !== campaign.plan.planId) throw new Error('GROWTH_RUN_EXPERIMENT_PLAN_REF_MISMATCH');
  if (experiment.actionPlanHash !== campaign.plan.approvalHash) throw new Error('GROWTH_RUN_EXPERIMENT_PLAN_HASH_MISMATCH');
  if (experiment.approvalHash && experimentApprovalHash(experiment) !== experiment.approvalHash) throw new Error('GROWTH_RUN_EXPERIMENT_HASH_INVALID');

  if (action.actionFamily !== envelope.actionFamily) throw new Error('GROWTH_RUN_ACTION_FAMILY_MISMATCH');
  if (envelope.delegateSubjectId && action.requestedBy !== envelope.delegateSubjectId) throw new Error('GROWTH_RUN_DELEGATE_MISMATCH');
  if (action.businessSnapshotId !== snapshot.snapshotId) throw new Error('GROWTH_RUN_ACTION_SNAPSHOT_MISMATCH');
  if (action.opportunityId !== opportunity.opportunityId) throw new Error('GROWTH_RUN_ACTION_OPPORTUNITY_MISMATCH');
  if (action.experimentId !== experiment.experimentId) throw new Error('GROWTH_RUN_ACTION_EXPERIMENT_MISMATCH');

  const actionHash = actionApprovalHash(action);
  if (attempt.actionId !== action.actionId || attempt.actionHash !== actionHash) throw new Error('GROWTH_RUN_ATTEMPT_ACTION_MISMATCH');

  if (policyReceipt) assertPolicyReceiptMatches({ receipt: policyReceipt, action, envelope });

  const allowedCorrelations = new Set([runId, campaign.campaignId, experiment.experimentId, action.actionId]);
  const outcomeEventIds = [];
  for (const event of outcomeEvents) {
    if (!event || typeof event !== 'object') throw new Error('outcome event must be an object.');
    if (event.tenantId !== tenantId) throw new Error('GROWTH_RUN_OUTCOME_TENANT_MISMATCH');
    requiredString(event.eventId, 'outcome event.eventId');
    if (!allowedCorrelations.has(event.correlationId)) throw new Error('GROWTH_RUN_OUTCOME_CORRELATION_MISMATCH');
    outcomeEventIds.push(event.eventId);
  }

  return {
    tenantId,
    actionHash,
    envelopeHash: envelopeAuthorityHash(envelope),
    planHash: campaign.plan.approvalHash,
    experimentHash: experiment.approvalHash ?? experimentApprovalHash(experiment),
    outcomeEventIds
  };
}

export function createGrowthRunManifest(input) {
  const proof = assertGrowthRunConsistency(input);
  const manifest = {
    schemaVersion: 1,
    runId: input.runId,
    tenantId: proof.tenantId,
    snapshotId: input.snapshot.snapshotId,
    opportunityId: input.opportunity.opportunityId,
    campaignId: input.campaign.campaignId,
    planId: input.campaign.plan.planId,
    planHash: proof.planHash,
    experimentId: input.experiment.experimentId,
    experimentHash: proof.experimentHash,
    envelopeId: input.envelope.envelopeId,
    envelopeHash: proof.envelopeHash,
    actionId: input.action.actionId,
    actionHash: proof.actionHash,
    attemptId: input.attempt.attemptId,
    policyReceiptId: input.policyReceipt?.receiptId ?? null,
    outcomeEventIds: proof.outcomeEventIds,
    createdAt: new Date().toISOString()
  };
  return { ...manifest, manifestHash: sha256Canonical(manifest) };
}

export function validateGrowthRunManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('manifest must be an object.');
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported manifest schemaVersion.');
  for (const field of ['runId','tenantId','snapshotId','opportunityId','campaignId','planId','planHash','experimentId','experimentHash','envelopeId','envelopeHash','actionId','actionHash','attemptId','createdAt','manifestHash']) {
    requiredString(manifest[field], `manifest.${field}`);
  }
  for (const field of ['planHash','experimentHash','envelopeHash','actionHash','manifestHash']) {
    if (!/^[a-f0-9]{64}$/.test(manifest[field])) throw new Error(`manifest.${field} must be SHA-256 hex.`);
  }
  if (!Array.isArray(manifest.outcomeEventIds) || manifest.outcomeEventIds.some((id) => typeof id !== 'string' || !id.trim())) throw new Error('manifest.outcomeEventIds must be an array of IDs.');
  if (growthRunManifestHash(manifest) !== manifest.manifestHash) throw new Error('GROWTH_RUN_MANIFEST_HASH_MISMATCH');
  return manifest;
}

export function assertGrowthRunManifestMatches(manifest, input) {
  validateGrowthRunManifest(manifest);
  const fresh = createGrowthRunManifest({ ...input, runId: manifest.runId });
  const fields = ['tenantId','snapshotId','opportunityId','campaignId','planId','planHash','experimentId','experimentHash','envelopeId','envelopeHash','actionId','actionHash','attemptId','policyReceiptId'];
  for (const field of fields) if (manifest[field] !== fresh[field]) throw new Error(`GROWTH_RUN_MANIFEST_SOURCE_CHANGED:${field}`);
  if (sha256Canonical(manifest.outcomeEventIds) !== sha256Canonical(fresh.outcomeEventIds)) throw new Error('GROWTH_RUN_MANIFEST_SOURCE_CHANGED:outcomeEventIds');
  return true;
}
