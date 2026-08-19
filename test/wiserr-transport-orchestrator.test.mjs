import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Canonical } from '../src/core/canonical.mjs';
import { capacityExecutionProofHash } from '../src/core/capacity-execution-proof.mjs';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import { buildReactivationPlan } from '../src/reactivation/plan.mjs';
import { createDurableReactivationCampaign, submitDurableReactivationCampaignForApproval, approveDurableReactivationCampaign, loadDurableReactivationCampaign } from '../src/runtime/reactivation-campaign-repository.mjs';
import { persistDurableWiserrReactivationCommand } from '../src/runtime/wiserr-reactivation-command-repository.mjs';
import { loadDurableExecutionAttempt } from '../src/runtime/execution-attempt-repository.mjs';
import { executePreparedWiserrReactivationSubmission } from '../src/runtime/wiserr-transport-orchestrator.mjs';
import { WISERR_REACTIVATION_SMS_DEPENDENCY_ID } from '../src/integrations/wiserr/reactivation-sms-authority.mjs';

const NOW = new Date('2026-08-19T12:00:00.000Z');

function capacityProof() {
  const body = { schemaVersion: 1, tenantId: 'tenant-1', capacityBundleId: 'capacity-1', capacitySemanticHash: 'c'.repeat(64), evidenceId: 'evidence-1', authorityId: 'authority-1', authorityHash: 'd'.repeat(64), sourceSystem: 'wiserr', sourceAuthority: 'capacity-authority', scopeKey: 'tenant', asOf: '2026-08-19T11:55:00.000Z', validUntil: '2026-08-19T12:30:00.000Z', derivedStatus: 'AVAILABLE', demandThrottleRecommended: false, authorityDecision: 'READY' };
  return { ...body, proofHash: capacityExecutionProofHash(body) };
}

function smsReady() { return { decision: 'READY', reasons: ['UPSTREAM_AUTHORITY_CERTIFIED'], metadata: { dependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID, lockFingerprint: '1'.repeat(64) } }; }
function runtime(store) { return { tenantId: 'tenant-1', mode: 'EXECUTION_ENABLED', executionEnabled: true, executionStore: store, executionBlockers: [] }; }

async function setup() {
  const store = new AtomicInMemoryRuntimeStore();
  const proof = capacityProof();
  const authority = smsReady();
  const snapshot = { schemaVersion: 1, snapshotId: 'snapshot-1', tenantId: 'tenant-1', generatedAt: NOW.toISOString(), completeness: 'PARTIAL', capacity: { status: 'UNKNOWN', demandThrottleRecommended: false }, reactivation: { cohortDefinitionId: 'dormant-leads', cohortDefinitionVersion: 'v1', dormantCount: 100, suppressedCount: 20, eligibleByChannel: { sms: 80, email: 0, whatsapp: 0 } }, capabilities: { reactivationSms: false, reactivationEmail: false, reactivationWhatsapp: false, lunaReplyHandling: false, bookingOutcomes: false } };
  const opportunity = { opportunityId: 'opp-1', tenantId: 'tenant-1', businessSnapshotId: 'snapshot-1', type: 'DORMANT_LEAD_REACTIVATION' };
  const plan = buildReactivationPlan({ opportunity, snapshot, channel: 'sms', message: { strategy: 'return-help', body: 'PRIVATE CUSTOMER MESSAGE', version: 'v1' }, requestedMaxRecipients: 50, maxAttempts: 1 });
  const created = await createDurableReactivationCampaign({ store, plan, now: NOW });
  const submitted = await submitDurableReactivationCampaignForApproval({ store, tenantId: 'tenant-1', campaignId: created.record.recordId, now: NOW });
  const campaign = await approveDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: submitted.recordId, approvalId: 'approval-1', approvedBy: 'owner-1', approvedPlanHash: plan.approvalHash, approvalAuthorityRef: 'wiserr://authority/owner-1/reactivation', approvedAt: NOW });
  const commandBody = { schemaVersion: 1, commandId: 'command-1', tenantId: 'tenant-1', actionId: 'action-1', actionHash: 'a'.repeat(64), campaignId: campaign.recordId, opportunityId: plan.opportunityId, experimentId: 'experiment-1', planId: plan.planId, planApprovalHash: plan.approvalHash, campaignApprovalId: campaign.payload.approval.approvalId, policyReceiptId: 'policy-1', policyReceiptHash: 'b'.repeat(64), envelopeId: 'envelope-1', envelopeHash: 'e'.repeat(64), attemptId: 'attempt-1', attemptNumber: 1, idempotencyKey: 'growthos:tenant-1:action-1:attempt:1', capacityBundleId: proof.capacityBundleId, capacityProofHash: proof.proofHash, capacitySemanticHash: proof.capacitySemanticHash, capacityAuthorityHash: proof.authorityHash, executionAuthorityDependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID, executionAuthorityLockFingerprint: authority.metadata.lockFingerprint, originalBusinessSnapshotId: plan.businessSnapshotId, executionBusinessSnapshotId: 'snapshot-execution-1', cohortDefinitionId: plan.cohort.definitionId, cohortDefinitionVersion: plan.cohort.definitionVersion, channel: 'sms', accountId: 'wiserr-primary', geography: 'tampa-fl', maxRecipients: 35, message: structuredClone(plan.message), frequencyPolicy: structuredClone(plan.frequencyPolicy) };
  const command = { ...commandBody, commandHash: sha256Canonical(commandBody) };
  await persistDurableWiserrReactivationCommand({ store, command, now: NOW });
  const attempt = { schemaVersion: 1, attemptId: command.attemptId, tenantId: command.tenantId, actionId: command.actionId, actionHash: command.actionHash, attemptNumber: 1, idempotencyKey: command.idempotencyKey, state: 'CREATED', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), externalExecutionId: null, result: null, error: null, reconciliation: null, events: [] };
  await store.putRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: attempt.attemptId, indexKey: attempt.actionId, payload: attempt, expectedRevision: 0, now: NOW });
  return { store, runtime: runtime(store), campaign, command, proof, authority };
}

function completedResult(command) { return { schemaVersion: 1, resultId: 'result-1', tenantId: command.tenantId, commandId: command.commandId, attemptId: command.attemptId, outcome: 'COMPLETED', classification: 'WISERR_ACCEPTED_AND_COMPLETED', evidenceRef: 'wiserr://submission/result-1', observedAt: NOW.toISOString(), externalExecutionId: 'wiserr-exec-1' }; }

test('transport is called once only after durable preparation and canonical result closes execution into observation', async () => {
  const { store, runtime: rt, campaign, command, proof, authority } = await setup();
  let calls = 0;
  const result = await executePreparedWiserrReactivationSubmission({ runtime: rt, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: command.commandId, capacityProof: proof, executionAuthorityDecision: authority, now: NOW, transport: async request => { calls += 1; assert.equal(request.idempotencyKey, command.idempotencyKey); const attempt = await loadDurableExecutionAttempt({ store, tenantId: 'tenant-1', attemptId: command.attemptId }); assert.equal(attempt.payload.state, 'SUBMITTING'); return completedResult(command); } });
  assert.equal(calls, 1);
  assert.equal(result.outcome, 'COMPLETED');
  assert.equal(result.attemptState, 'COMPLETED');
  assert.equal(result.campaignState, 'OBSERVING');
});

test('transport exception after SUBMITTING is never retried and is surfaced as reconciliation-required work', async () => {
  const { store, runtime: rt, campaign, command, proof, authority } = await setup();
  let calls = 0;
  await assert.rejects(() => executePreparedWiserrReactivationSubmission({ runtime: rt, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: command.commandId, capacityProof: proof, executionAuthorityDecision: authority, now: NOW, transport: async () => { calls += 1; throw new Error('network timeout'); } }), error => error.code === 'WISERR_TRANSPORT_OUTCOME_REQUIRES_RECONCILIATION' && error.requiresReconciliation === true);
  assert.equal(calls, 1);
  const attempt = await loadDurableExecutionAttempt({ store, tenantId: 'tenant-1', attemptId: command.attemptId });
  assert.equal(attempt.payload.state, 'SUBMITTING');
  await assert.rejects(() => executePreparedWiserrReactivationSubmission({ runtime: rt, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: command.commandId, capacityProof: proof, executionAuthorityDecision: authority, now: NOW, transport: async () => { calls += 1; return completedResult(command); } }), /WISERR_SUBMISSION_REPLAY_REFUSED:SUBMITTING/);
  assert.equal(calls, 1);
});

test('invalid or cross-command transport result is treated as ambiguous and not applied', async () => {
  const { store, runtime: rt, campaign, command, proof, authority } = await setup();
  const bad = { ...completedResult(command), commandId: 'other-command' };
  await assert.rejects(() => executePreparedWiserrReactivationSubmission({ runtime: rt, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: command.commandId, capacityProof: proof, executionAuthorityDecision: authority, now: NOW, transport: async () => bad }), error => error.code === 'WISERR_TRANSPORT_OUTCOME_REQUIRES_RECONCILIATION');
  const attempt = await loadDurableExecutionAttempt({ store, tenantId: 'tenant-1', attemptId: command.attemptId });
  assert.equal(attempt.payload.state, 'SUBMITTING');
  const persistedCampaign = await loadDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: campaign.recordId });
  assert.equal(persistedCampaign.payload.status, 'EXECUTING');
});
