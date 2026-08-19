import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Canonical } from '../src/core/canonical.mjs';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import { buildReactivationPlan } from '../src/reactivation/plan.mjs';
import {
  createDurableReactivationCampaign,
  submitDurableReactivationCampaignForApproval,
  approveDurableReactivationCampaign,
  startDurableReactivationCampaignFromPersistedCommand,
  loadDurableReactivationCampaign
} from '../src/runtime/reactivation-campaign-repository.mjs';
import { persistDurableWiserrReactivationCommand } from '../src/runtime/wiserr-reactivation-command-repository.mjs';
import { loadDurableExecutionAttempt } from '../src/runtime/execution-attempt-repository.mjs';
import { preparePersistedWiserrReactivationSubmission } from '../src/runtime/wiserr-submission-preparation.mjs';
import { WISERR_REACTIVATION_SMS_DEPENDENCY_ID } from '../src/integrations/wiserr/reactivation-sms-authority.mjs';

const NOW = new Date('2026-08-18T20:00:00.000Z');

function snapshot() {
  return {
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    tenantId: 'tenant-1',
    generatedAt: NOW.toISOString(),
    completeness: 'PARTIAL',
    capacity: { status: 'UNKNOWN', demandThrottleRecommended: false },
    reactivation: { cohortDefinitionId: 'dormant-leads', cohortDefinitionVersion: 'v1', dormantCount: 100, suppressedCount: 20, eligibleByChannel: { sms: 80, email: 0, whatsapp: 0 } },
    capabilities: { reactivationSms: false, reactivationEmail: false, reactivationWhatsapp: false, lunaReplyHandling: false, bookingOutcomes: false }
  };
}

async function setup() {
  const store = new AtomicInMemoryRuntimeStore();
  const opportunity = { opportunityId: 'opp-1', tenantId: 'tenant-1', businessSnapshotId: 'snapshot-1', type: 'DORMANT_LEAD_REACTIVATION' };
  const plan = buildReactivationPlan({ opportunity, snapshot: snapshot(), channel: 'sms', message: { strategy: 'return-help', body: 'PRIVATE CUSTOMER MESSAGE', version: 'v1' }, requestedMaxRecipients: 50, maxAttempts: 1 });
  const created = await createDurableReactivationCampaign({ store, plan, now: NOW });
  const ready = await submitDurableReactivationCampaignForApproval({ store, tenantId: 'tenant-1', campaignId: created.record.recordId, now: NOW });
  const campaign = await approveDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: ready.recordId, approvalId: 'approval-1', approvedBy: 'owner-1', approvedPlanHash: plan.approvalHash, approvalAuthorityRef: 'wiserr://authority/owner-1/reactivation', approvedAt: NOW });

  const commandBody = {
    schemaVersion: 1,
    commandId: 'wiserr-reactivation:tenant-1:action-1:attempt:1',
    tenantId: 'tenant-1', actionId: 'action-1', actionHash: 'a'.repeat(64), campaignId: campaign.recordId,
    opportunityId: plan.opportunityId, experimentId: 'experiment-1', planId: plan.planId, planApprovalHash: plan.approvalHash,
    campaignApprovalId: campaign.payload.approval.approvalId, policyReceiptId: 'policy-1', policyReceiptHash: 'b'.repeat(64),
    envelopeId: 'envelope-1', envelopeHash: 'c'.repeat(64), attemptId: 'attempt-1', attemptNumber: 1,
    idempotencyKey: 'growthos:tenant-1:action-1:attempt:1', capacityBundleId: 'capacity-bundle-1', capacityProofHash: 'd'.repeat(64),
    capacitySemanticHash: 'e'.repeat(64), capacityAuthorityHash: 'f'.repeat(64), executionAuthorityDependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID,
    executionAuthorityLockFingerprint: '1'.repeat(64), originalBusinessSnapshotId: plan.businessSnapshotId, executionBusinessSnapshotId: 'snapshot-execution-1',
    cohortDefinitionId: plan.cohort.definitionId, cohortDefinitionVersion: plan.cohort.definitionVersion, channel: 'sms', accountId: 'wiserr-primary',
    geography: 'tampa-fl', maxRecipients: 35, message: structuredClone(plan.message), frequencyPolicy: structuredClone(plan.frequencyPolicy)
  };
  const command = { ...commandBody, commandHash: sha256Canonical(commandBody) };
  await persistDurableWiserrReactivationCommand({ store, command, now: NOW });

  const attempt = {
    schemaVersion: 1, attemptId: command.attemptId, tenantId: command.tenantId, actionId: command.actionId,
    actionHash: command.actionHash, attemptNumber: command.attemptNumber, idempotencyKey: command.idempotencyKey,
    state: 'CREATED', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), externalExecutionId: null,
    result: null, error: null, reconciliation: null, events: []
  };
  await store.putRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: attempt.attemptId, indexKey: attempt.actionId, payload: attempt, expectedRevision: 0, now: NOW });
  return { store, campaign, command };
}

test('preparation durably reaches EXECUTING plus SUBMITTING before exposing command', async () => {
  const { store, campaign, command } = await setup();
  const prepared = await preparePersistedWiserrReactivationSubmission({ store, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: command.commandId, now: NOW });
  assert.equal(prepared.submissionAuthorized, true);
  assert.equal(prepared.campaignState, 'EXECUTING');
  assert.equal(prepared.attemptState, 'SUBMITTING');
  assert.equal(prepared.command.commandHash, command.commandHash);
  const persistedCampaign = await loadDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: campaign.recordId });
  const persistedAttempt = await loadDurableExecutionAttempt({ store, tenantId: 'tenant-1', attemptId: command.attemptId });
  assert.equal(persistedCampaign.payload.status, 'EXECUTING');
  assert.equal(persistedAttempt.payload.state, 'SUBMITTING');
});

test('crash after campaign start but before attempt SUBMITTING can resume preparation exactly once', async () => {
  const { store, campaign, command } = await setup();
  await startDurableReactivationCampaignFromPersistedCommand({ store, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: command.commandId, now: NOW });
  const before = await loadDurableExecutionAttempt({ store, tenantId: 'tenant-1', attemptId: command.attemptId });
  assert.equal(before.payload.state, 'CREATED');
  const prepared = await preparePersistedWiserrReactivationSubmission({ store, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: command.commandId, now: NOW });
  assert.equal(prepared.campaignState, 'EXECUTING');
  assert.equal(prepared.attemptState, 'SUBMITTING');
});

test('retry after SUBMITTING refuses to return command again and requires reconciliation', async () => {
  const { store, campaign, command } = await setup();
  await preparePersistedWiserrReactivationSubmission({ store, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: command.commandId, now: NOW });
  await assert.rejects(
    () => preparePersistedWiserrReactivationSubmission({ store, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: command.commandId, now: NOW }),
    error => error.message === 'WISERR_SUBMISSION_REPLAY_REFUSED:SUBMITTING' && error.requiresReconciliation === true
  );
});

test('missing attempt blocks before campaign mutation', async () => {
  const { store, campaign, command } = await setup();
  const key = store.recordKey({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: command.attemptId });
  store.records.delete(key);
  await assert.rejects(
    () => preparePersistedWiserrReactivationSubmission({ store, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: command.commandId, now: NOW }),
    /WISERR_SUBMISSION_ATTEMPT_NOT_FOUND/
  );
  const unchanged = await loadDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: campaign.recordId });
  assert.equal(unchanged.payload.status, 'APPROVED');
});
