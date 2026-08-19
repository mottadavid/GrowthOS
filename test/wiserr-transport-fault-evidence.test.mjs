import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Canonical } from '../src/core/canonical.mjs';
import { capacityExecutionProofHash } from '../src/core/capacity-execution-proof.mjs';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import { buildReactivationPlan } from '../src/reactivation/plan.mjs';
import { createDurableReactivationCampaign, submitDurableReactivationCampaignForApproval, approveDurableReactivationCampaign, loadDurableReactivationCampaign } from '../src/runtime/reactivation-campaign-repository.mjs';
import { persistDurableWiserrReactivationCommand } from '../src/runtime/wiserr-reactivation-command-repository.mjs';
import { loadDurableExecutionAttempt } from '../src/runtime/execution-attempt-repository.mjs';
import { persistDurableWiserrTransportFault } from '../src/runtime/wiserr-transport-fault-repository.mjs';
import { executeWiserrReactivationWithDurableFaultEvidence } from '../src/runtime/wiserr-transport-execution.mjs';
import { WISERR_REACTIVATION_SMS_DEPENDENCY_ID } from '../src/integrations/wiserr/reactivation-sms-authority.mjs';

const NOW = new Date('2026-08-19T12:00:00.000Z');

function proof() { const body = { schemaVersion: 1, tenantId: 'tenant-1', capacityBundleId: 'capacity-1', capacitySemanticHash: 'c'.repeat(64), evidenceId: 'evidence-1', authorityId: 'authority-1', authorityHash: 'd'.repeat(64), sourceSystem: 'wiserr', sourceAuthority: 'capacity-authority', scopeKey: 'tenant', asOf: '2026-08-19T11:55:00.000Z', validUntil: '2026-08-19T12:30:00.000Z', derivedStatus: 'AVAILABLE', demandThrottleRecommended: false, authorityDecision: 'READY' }; return { ...body, proofHash: capacityExecutionProofHash(body) }; }
function authority() { return { decision: 'READY', reasons: ['UPSTREAM_AUTHORITY_CERTIFIED'], metadata: { dependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID, lockFingerprint: '1'.repeat(64) } }; }
function runtime(store) { return { tenantId: 'tenant-1', mode: 'EXECUTION_ENABLED', executionEnabled: true, executionStore: store, executionBlockers: [] }; }

async function setup() {
  const store = new AtomicInMemoryRuntimeStore(); const capacityProof = proof(); const executionAuthorityDecision = authority();
  const snapshot = { schemaVersion: 1, snapshotId: 'snapshot-1', tenantId: 'tenant-1', generatedAt: NOW.toISOString(), completeness: 'PARTIAL', capacity: { status: 'UNKNOWN', demandThrottleRecommended: false }, reactivation: { cohortDefinitionId: 'dormant-leads', cohortDefinitionVersion: 'v1', dormantCount: 100, suppressedCount: 20, eligibleByChannel: { sms: 80, email: 0, whatsapp: 0 } }, capabilities: { reactivationSms: false, reactivationEmail: false, reactivationWhatsapp: false, lunaReplyHandling: false, bookingOutcomes: false } };
  const opportunity = { opportunityId: 'opp-1', tenantId: 'tenant-1', businessSnapshotId: 'snapshot-1', type: 'DORMANT_LEAD_REACTIVATION' };
  const plan = buildReactivationPlan({ opportunity, snapshot, channel: 'sms', message: { strategy: 'return-help', body: 'PRIVATE CUSTOMER MESSAGE', version: 'v1' }, requestedMaxRecipients: 50, maxAttempts: 1 });
  const created = await createDurableReactivationCampaign({ store, plan, now: NOW }); const submitted = await submitDurableReactivationCampaignForApproval({ store, tenantId: 'tenant-1', campaignId: created.record.recordId, now: NOW }); const campaign = await approveDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: submitted.recordId, approvalId: 'approval-1', approvedBy: 'owner-1', approvedPlanHash: plan.approvalHash, approvalAuthorityRef: 'wiserr://authority/owner-1/reactivation', approvedAt: NOW });
  const body = { schemaVersion: 1, commandId: 'command-1', tenantId: 'tenant-1', actionId: 'action-1', actionHash: 'a'.repeat(64), campaignId: campaign.recordId, opportunityId: plan.opportunityId, experimentId: 'experiment-1', planId: plan.planId, planApprovalHash: plan.approvalHash, campaignApprovalId: campaign.payload.approval.approvalId, policyReceiptId: 'policy-1', policyReceiptHash: 'b'.repeat(64), envelopeId: 'envelope-1', envelopeHash: 'e'.repeat(64), attemptId: 'attempt-1', attemptNumber: 1, idempotencyKey: 'growthos:tenant-1:action-1:attempt:1', capacityBundleId: capacityProof.capacityBundleId, capacityProofHash: capacityProof.proofHash, capacitySemanticHash: capacityProof.capacitySemanticHash, capacityAuthorityHash: capacityProof.authorityHash, executionAuthorityDependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID, executionAuthorityLockFingerprint: executionAuthorityDecision.metadata.lockFingerprint, originalBusinessSnapshotId: plan.businessSnapshotId, executionBusinessSnapshotId: 'snapshot-execution-1', cohortDefinitionId: plan.cohort.definitionId, cohortDefinitionVersion: plan.cohort.definitionVersion, channel: 'sms', accountId: 'wiserr-primary', geography: 'tampa-fl', maxRecipients: 35, message: structuredClone(plan.message), frequencyPolicy: structuredClone(plan.frequencyPolicy) };
  const command = { ...body, commandHash: sha256Canonical(body) }; await persistDurableWiserrReactivationCommand({ store, command, now: NOW });
  const attempt = { schemaVersion: 1, attemptId: command.attemptId, tenantId: command.tenantId, actionId: command.actionId, actionHash: command.actionHash, attemptNumber: 1, idempotencyKey: command.idempotencyKey, state: 'CREATED', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), externalExecutionId: null, result: null, error: null, reconciliation: null, events: [] };
  await store.putRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: attempt.attemptId, indexKey: attempt.actionId, payload: attempt, expectedRevision: 0, now: NOW });
  return { store, runtime: runtime(store), campaign, command, capacityProof, executionAuthorityDecision };
}

test('transport fault receipt is privacy-safe and exact replay is idempotent', async () => {
  const store = new AtomicInMemoryRuntimeStore(); const error = new Error('PRIVATE PROVIDER PAYLOAD SHOULD NOT PERSIST'); error.code = 'ETIMEDOUT';
  const first = await persistDurableWiserrTransportFault({ store, tenantId: 'tenant-1', commandId: 'command-1', attemptId: 'attempt-1', error, now: NOW });
  const second = await persistDurableWiserrTransportFault({ store, tenantId: 'tenant-1', commandId: 'command-1', attemptId: 'attempt-1', error, now: NOW });
  assert.equal(first.idempotent, false); assert.equal(second.idempotent, true); assert.equal(first.record.payload.errorCode, 'ETIMEDOUT');
  assert.equal(JSON.stringify(first.record).includes('PRIVATE PROVIDER PAYLOAD'), false);
});

test('ambiguous transport failure persists local evidence and moves attempt/campaign to reconciliation without retry', async () => {
  const { store, runtime: rt, campaign, command, capacityProof, executionAuthorityDecision } = await setup(); let calls = 0;
  await assert.rejects(() => executeWiserrReactivationWithDurableFaultEvidence({ runtime: rt, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: command.commandId, capacityProof, executionAuthorityDecision, now: NOW, transport: async () => { calls += 1; const error = new Error('socket timeout PRIVATE'); error.code = 'ETIMEDOUT'; throw error; } }), error => error.code === 'WISERR_TRANSPORT_OUTCOME_REQUIRES_RECONCILIATION' && typeof error.evidenceRef === 'string');
  assert.equal(calls, 1);
  const attempt = await loadDurableExecutionAttempt({ store, tenantId: 'tenant-1', attemptId: command.attemptId }); const persistedCampaign = await loadDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: campaign.recordId });
  assert.equal(attempt.payload.state, 'RECONCILIATION_REQUIRED'); assert.equal(persistedCampaign.payload.status, 'RECONCILIATION_REQUIRED');
  assert.equal(JSON.stringify(attempt).includes('socket timeout PRIVATE'), false);
  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: command.attemptId }); assert.equal(JSON.stringify(events).includes('socket timeout PRIVATE'), false);
});
