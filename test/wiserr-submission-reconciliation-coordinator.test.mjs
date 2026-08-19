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
import { loadDurableExecutionAttempt, reconcileDurableExecutionAttempt } from '../src/runtime/execution-attempt-repository.mjs';
import { ingestWiserrReactivationSubmissionResultAndAdvanceCampaign } from '../src/runtime/wiserr-submission-campaign-coordinator.mjs';
import { reconcileWiserrReactivationSubmissionAndCampaign } from '../src/runtime/wiserr-submission-reconciliation-coordinator.mjs';
import { WISERR_REACTIVATION_SMS_DEPENDENCY_ID } from '../src/integrations/wiserr/reactivation-sms-authority.mjs';

const NOW = new Date('2026-08-18T20:00:00.000Z');
const LATER = new Date('2026-08-18T20:05:00.000Z');
function runtime(store) { return Object.freeze({ schemaVersion: 1, tenantId: 'tenant-1', mode: 'EXECUTION_ENABLED', executionEnabled: true, executionBlockers: [], executionStore: store }); }
function snapshot() { return { schemaVersion: 1, snapshotId: 'snapshot-1', tenantId: 'tenant-1', generatedAt: NOW.toISOString(), completeness: 'PARTIAL', capacity: { status: 'UNKNOWN', demandThrottleRecommended: false }, reactivation: { cohortDefinitionId: 'dormant-leads', cohortDefinitionVersion: 'v1', dormantCount: 100, suppressedCount: 20, eligibleByChannel: { sms: 80, email: 0, whatsapp: 0 } }, capabilities: { reactivationSms: false, reactivationEmail: false, reactivationWhatsapp: false, lunaReplyHandling: false, bookingOutcomes: false } }; }

async function setupReconciliationRequired() {
  const store = new AtomicInMemoryRuntimeStore();
  const opportunity = { opportunityId: 'opp-1', tenantId: 'tenant-1', businessSnapshotId: 'snapshot-1', type: 'DORMANT_LEAD_REACTIVATION' };
  const plan = buildReactivationPlan({ opportunity, snapshot: snapshot(), channel: 'sms', message: { strategy: 'return-help', body: 'PRIVATE CUSTOMER MESSAGE', version: 'v1' }, requestedMaxRecipients: 50, maxAttempts: 1 });
  const created = await createDurableReactivationCampaign({ store, plan, now: NOW });
  const ready = await submitDurableReactivationCampaignForApproval({ store, tenantId: 'tenant-1', campaignId: created.record.recordId, now: NOW });
  const approved = await approveDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: ready.recordId, approvalId: 'approval-1', approvedBy: 'owner-1', approvedPlanHash: plan.approvalHash, approvalAuthorityRef: 'wiserr://authority/owner-1/reactivation', approvedAt: NOW });
  const body = { schemaVersion: 1, commandId: 'wiserr-reactivation:tenant-1:action-1:attempt:1', tenantId: 'tenant-1', actionId: 'action-1', actionHash: 'a'.repeat(64), campaignId: approved.recordId, opportunityId: plan.opportunityId, experimentId: 'experiment-1', planId: plan.planId, planApprovalHash: plan.approvalHash, campaignApprovalId: approved.payload.approval.approvalId, policyReceiptId: 'policy-1', policyReceiptHash: 'b'.repeat(64), envelopeId: 'envelope-1', envelopeHash: 'c'.repeat(64), attemptId: 'attempt-1', attemptNumber: 1, idempotencyKey: 'growthos:tenant-1:action-1:attempt:1', capacityBundleId: 'capacity-1', capacityProofHash: 'd'.repeat(64), capacitySemanticHash: 'e'.repeat(64), capacityAuthorityHash: 'f'.repeat(64), executionAuthorityDependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID, executionAuthorityLockFingerprint: '1'.repeat(64), originalBusinessSnapshotId: plan.businessSnapshotId, executionBusinessSnapshotId: 'snapshot-execution-1', cohortDefinitionId: plan.cohort.definitionId, cohortDefinitionVersion: plan.cohort.definitionVersion, channel: 'sms', accountId: 'wiserr-primary', geography: 'tampa-fl', maxRecipients: 35, message: structuredClone(plan.message), frequencyPolicy: structuredClone(plan.frequencyPolicy) };
  const command = { ...body, commandHash: sha256Canonical(body) };
  await persistDurableWiserrReactivationCommand({ store, command, now: NOW });
  const attempt = { schemaVersion: 1, attemptId: command.attemptId, tenantId: command.tenantId, actionId: command.actionId, actionHash: command.actionHash, attemptNumber: 1, idempotencyKey: command.idempotencyKey, state: 'SUBMITTING', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), externalExecutionId: null, result: null, error: null, suppression: null, reconciliation: null, events: [] };
  await store.putRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: attempt.attemptId, indexKey: attempt.actionId, payload: attempt, expectedRevision: 0, now: NOW });
  await startDurableReactivationCampaignFromPersistedCommand({ store, tenantId: 'tenant-1', campaignId: approved.recordId, commandId: command.commandId, now: NOW });
  const rt = runtime(store);
  await ingestWiserrReactivationSubmissionResultAndAdvanceCampaign({ runtime: rt, result: { schemaVersion: 1, resultId: 'ambiguous-1', tenantId: 'tenant-1', commandId: command.commandId, attemptId: command.attemptId, outcome: 'AMBIGUOUS', classification: 'OUTCOME_UNKNOWN', evidenceRef: 'wiserr://reconciliation/attempt-1', externalExecutionId: null, observedAt: NOW.toISOString() }, now: NOW });
  return { store, runtime: rt, campaignId: approved.recordId, attemptId: command.attemptId };
}

test('COMPLETED reconciliation advances attempt to RECONCILED_COMPLETED and campaign to OBSERVING', async () => {
  const ctx = await setupReconciliationRequired();
  const result = await reconcileWiserrReactivationSubmissionAndCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', campaignId: ctx.campaignId, attemptId: ctx.attemptId, outcome: 'COMPLETED', by: 'operator-1', evidence: 'wiserr://lookup/provider-message-1', now: LATER });
  assert.equal(result.attemptState, 'RECONCILED_COMPLETED');
  assert.equal(result.campaignState, 'OBSERVING');
  assert.equal(result.attemptTransitioned, true);
  assert.equal(result.campaignTransitioned, true);
});

test('FAILED and NOT_ACCEPTED reconciliation fail the campaign without creating another attempt', async () => {
  for (const outcome of ['FAILED', 'NOT_ACCEPTED']) {
    const ctx = await setupReconciliationRequired();
    const result = await reconcileWiserrReactivationSubmissionAndCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', campaignId: ctx.campaignId, attemptId: ctx.attemptId, outcome, by: 'operator-1', evidence: `wiserr://lookup/${outcome.toLowerCase()}`, now: LATER });
    assert.equal(result.attemptState, 'RECONCILED_FAILED');
    assert.equal(result.campaignState, 'FAILED');
  }
});

test('crash after attempt reconciliation but before campaign transition resumes only the campaign transition', async () => {
  const ctx = await setupReconciliationRequired();
  await reconcileDurableExecutionAttempt({ store: ctx.store, tenantId: 'tenant-1', attemptId: ctx.attemptId, outcome: 'COMPLETED', by: 'operator-1', evidence: 'wiserr://lookup/provider-message-1', result: { reconciliationEvidenceRef: 'wiserr://lookup/provider-message-1' }, now: LATER });
  assert.equal((await loadDurableReactivationCampaign({ store: ctx.store, tenantId: 'tenant-1', campaignId: ctx.campaignId })).payload.status, 'RECONCILIATION_REQUIRED');
  const resumed = await reconcileWiserrReactivationSubmissionAndCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', campaignId: ctx.campaignId, attemptId: ctx.attemptId, outcome: 'COMPLETED', by: 'operator-1', evidence: 'wiserr://lookup/provider-message-1', now: LATER });
  assert.equal(resumed.attemptTransitioned, false);
  assert.equal(resumed.campaignTransitioned, true);
  assert.equal(resumed.campaignState, 'OBSERVING');
});

test('exact reconciliation replay is idempotent after both durable transitions', async () => {
  const ctx = await setupReconciliationRequired();
  const args = { runtime: ctx.runtime, tenantId: 'tenant-1', campaignId: ctx.campaignId, attemptId: ctx.attemptId, outcome: 'COMPLETED', by: 'operator-1', evidence: 'wiserr://lookup/provider-message-1', now: LATER };
  await reconcileWiserrReactivationSubmissionAndCampaign(args);
  const replay = await reconcileWiserrReactivationSubmissionAndCampaign(args);
  assert.equal(replay.attemptTransitioned, false);
  assert.equal(replay.campaignTransitioned, false);
  assert.equal(replay.attemptState, 'RECONCILED_COMPLETED');
  assert.equal(replay.campaignState, 'OBSERVING');
});

test('changed reconciliation evidence cannot reuse a resolved attempt', async () => {
  const ctx = await setupReconciliationRequired();
  await reconcileWiserrReactivationSubmissionAndCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', campaignId: ctx.campaignId, attemptId: ctx.attemptId, outcome: 'COMPLETED', by: 'operator-1', evidence: 'wiserr://lookup/provider-message-1', now: LATER });
  await assert.rejects(() => reconcileWiserrReactivationSubmissionAndCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', campaignId: ctx.campaignId, attemptId: ctx.attemptId, outcome: 'COMPLETED', by: 'operator-1', evidence: 'wiserr://lookup/different', now: LATER }), /WISERR_RECONCILIATION_EVIDENCE_CONFLICT/);
});

test('reconciliation refuses a campaign that is not tied to the attempt before any state change', async () => {
  const ctx = await setupReconciliationRequired();
  const key = ctx.store.recordKey({ tenantId: 'tenant-1', recordType: 'reactivation_campaign', recordId: ctx.campaignId });
  ctx.store.records.get(key).payload.attemptIds = ['other-attempt'];
  await assert.rejects(() => reconcileWiserrReactivationSubmissionAndCampaign({ runtime: ctx.runtime, tenantId: 'tenant-1', campaignId: ctx.campaignId, attemptId: ctx.attemptId, outcome: 'COMPLETED', by: 'operator-1', evidence: 'wiserr://lookup/provider-message-1', now: LATER }), /RUNTIME_RECORD_HASH_MISMATCH|WISERR_RECONCILIATION_CAMPAIGN_ATTEMPT_MISMATCH/);
  assert.equal((await loadDurableExecutionAttempt({ store: ctx.store, tenantId: 'tenant-1', attemptId: ctx.attemptId })).payload.state, 'RECONCILIATION_REQUIRED');
});
