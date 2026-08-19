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
  loadDurableReactivationCampaign,
  stopDurableReactivationCampaign
} from '../src/runtime/reactivation-campaign-repository.mjs';
import { persistDurableWiserrReactivationCommand } from '../src/runtime/wiserr-reactivation-command-repository.mjs';
import { loadDurableExecutionAttempt } from '../src/runtime/execution-attempt-repository.mjs';
import { ingestWiserrReactivationSubmissionResult, loadDurableWiserrSubmissionResult } from '../src/runtime/wiserr-submission-result-ingestion.mjs';
import { ingestWiserrReactivationSubmissionResultAndAdvanceCampaign } from '../src/runtime/wiserr-submission-campaign-coordinator.mjs';
import { WISERR_REACTIVATION_SMS_DEPENDENCY_ID } from '../src/integrations/wiserr/reactivation-sms-authority.mjs';

const NOW = new Date('2026-08-18T20:00:00.000Z');

function runtime(store) {
  return Object.freeze({ schemaVersion: 1, tenantId: 'tenant-1', mode: 'EXECUTION_ENABLED', executionEnabled: true, executionBlockers: [], executionStore: store });
}

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

function result(overrides = {}) {
  return {
    schemaVersion: 1,
    resultId: 'result-1',
    tenantId: 'tenant-1',
    commandId: 'wiserr-reactivation:tenant-1:action-1:attempt:1',
    attemptId: 'attempt-1',
    outcome: 'ACCEPTED',
    classification: 'WISERR_ACCEPTED',
    evidenceRef: 'wiserr://messaging/result-1',
    externalExecutionId: 'provider-message-1',
    observedAt: NOW.toISOString(),
    ...overrides
  };
}

async function setup() {
  const store = new AtomicInMemoryRuntimeStore();
  const opportunity = { opportunityId: 'opp-1', tenantId: 'tenant-1', businessSnapshotId: 'snapshot-1', type: 'DORMANT_LEAD_REACTIVATION' };
  const plan = buildReactivationPlan({ opportunity, snapshot: snapshot(), channel: 'sms', message: { strategy: 'return-help', body: 'PRIVATE CUSTOMER MESSAGE', version: 'v1' }, requestedMaxRecipients: 50, maxAttempts: 1 });
  const created = await createDurableReactivationCampaign({ store, plan, now: NOW });
  const ready = await submitDurableReactivationCampaignForApproval({ store, tenantId: 'tenant-1', campaignId: created.record.recordId, now: NOW });
  const approved = await approveDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: ready.recordId, approvalId: 'approval-1', approvedBy: 'owner-1', approvedPlanHash: plan.approvalHash, approvalAuthorityRef: 'wiserr://authority/owner-1/reactivation', approvedAt: NOW });

  const body = {
    schemaVersion: 1,
    commandId: 'wiserr-reactivation:tenant-1:action-1:attempt:1', tenantId: 'tenant-1', actionId: 'action-1', actionHash: 'a'.repeat(64),
    campaignId: approved.recordId, opportunityId: plan.opportunityId, experimentId: 'experiment-1', planId: plan.planId, planApprovalHash: plan.approvalHash,
    campaignApprovalId: approved.payload.approval.approvalId, policyReceiptId: 'policy-1', policyReceiptHash: 'b'.repeat(64), envelopeId: 'envelope-1', envelopeHash: 'c'.repeat(64),
    attemptId: 'attempt-1', attemptNumber: 1, idempotencyKey: 'growthos:tenant-1:action-1:attempt:1', capacityBundleId: 'capacity-1', capacityProofHash: 'd'.repeat(64),
    capacitySemanticHash: 'e'.repeat(64), capacityAuthorityHash: 'f'.repeat(64), executionAuthorityDependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID,
    executionAuthorityLockFingerprint: '1'.repeat(64), originalBusinessSnapshotId: plan.businessSnapshotId, executionBusinessSnapshotId: 'snapshot-execution-1',
    cohortDefinitionId: plan.cohort.definitionId, cohortDefinitionVersion: plan.cohort.definitionVersion, channel: 'sms', accountId: 'wiserr-primary', geography: 'tampa-fl', maxRecipients: 35,
    message: structuredClone(plan.message), frequencyPolicy: structuredClone(plan.frequencyPolicy)
  };
  const command = { ...body, commandHash: sha256Canonical(body) };
  await persistDurableWiserrReactivationCommand({ store, command, now: NOW });
  const attempt = {
    schemaVersion: 1, attemptId: command.attemptId, tenantId: command.tenantId, actionId: command.actionId, actionHash: command.actionHash,
    attemptNumber: 1, idempotencyKey: command.idempotencyKey, state: 'SUBMITTING', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), externalExecutionId: null,
    result: null, error: null, suppression: null, reconciliation: null, events: []
  };
  await store.putRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: attempt.attemptId, indexKey: attempt.actionId, payload: attempt, expectedRevision: 0, now: NOW });
  await startDurableReactivationCampaignFromPersistedCommand({ store, tenantId: 'tenant-1', campaignId: approved.recordId, commandId: command.commandId, now: NOW });
  return { store, runtime: runtime(store), campaignId: approved.recordId, command };
}

async function state(store, campaignId) {
  return (await loadDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId })).payload.status;
}

test('ACCEPTED advances attempt but keeps campaign EXECUTING', async () => {
  const ctx = await setup();
  const applied = await ingestWiserrReactivationSubmissionResultAndAdvanceCampaign({ runtime: ctx.runtime, result: result(), now: NOW });
  assert.equal(applied.attemptState, 'ACCEPTED');
  assert.equal(applied.campaignState, 'EXECUTING');
  assert.equal(applied.campaignTransitioned, false);
});

test('COMPLETED advances campaign to OBSERVING and exact replay is idempotent', async () => {
  const ctx = await setup();
  const inbound = result({ resultId: 'result-completed', outcome: 'COMPLETED', classification: 'WISERR_COMPLETED' });
  const first = await ingestWiserrReactivationSubmissionResultAndAdvanceCampaign({ runtime: ctx.runtime, result: inbound, now: NOW });
  assert.equal(first.attemptState, 'COMPLETED');
  assert.equal(first.campaignState, 'OBSERVING');
  assert.equal(first.campaignTransitioned, true);
  const second = await ingestWiserrReactivationSubmissionResultAndAdvanceCampaign({ runtime: ctx.runtime, result: structuredClone(inbound), now: new Date('2026-08-18T20:01:00Z') });
  assert.equal(second.resultIdempotent, true);
  assert.equal(second.campaignState, 'OBSERVING');
  assert.equal(second.campaignTransitioned, false);
});

test('AMBIGUOUS moves attempt and campaign into reconciliation-required state', async () => {
  const ctx = await setup();
  const inbound = result({ resultId: 'result-ambiguous', outcome: 'AMBIGUOUS', classification: 'OUTCOME_UNKNOWN', evidenceRef: 'wiserr://reconciliation/attempt-1', externalExecutionId: null });
  const applied = await ingestWiserrReactivationSubmissionResultAndAdvanceCampaign({ runtime: ctx.runtime, result: inbound, now: NOW });
  assert.equal(applied.attemptState, 'RECONCILIATION_REQUIRED');
  assert.equal(applied.campaignState, 'RECONCILIATION_REQUIRED');
});

test('SUPPRESSED stops campaign without labeling the attempt a provider failure', async () => {
  const ctx = await setup();
  const inbound = result({ resultId: 'result-suppressed', outcome: 'SUPPRESSED', classification: 'RECIPIENT_OPTED_OUT', evidenceRef: 'wiserr://suppression/lead-1', externalExecutionId: null });
  const applied = await ingestWiserrReactivationSubmissionResultAndAdvanceCampaign({ runtime: ctx.runtime, result: inbound, now: NOW });
  assert.equal(applied.attemptState, 'SUPPRESSED');
  assert.equal(applied.campaignState, 'STOPPED');
});

test('NOT_ACCEPTED and DEFINITIVE_FAILURE fail the current campaign deterministically', async () => {
  for (const [outcome, expectedAttempt] of [['NOT_ACCEPTED', 'NOT_ACCEPTED'], ['DEFINITIVE_FAILURE', 'DEFINITIVE_FAILURE']]) {
    const ctx = await setup();
    const inbound = result({ resultId: `result-${outcome.toLowerCase()}`, outcome, classification: outcome, evidenceRef: `wiserr://failure/${outcome.toLowerCase()}`, externalExecutionId: null });
    const applied = await ingestWiserrReactivationSubmissionResultAndAdvanceCampaign({ runtime: ctx.runtime, result: inbound, now: NOW });
    assert.equal(applied.attemptState, expectedAttempt);
    assert.equal(applied.campaignState, 'FAILED');
  }
});

test('crash after result receipt/attempt transition but before campaign transition resumes without another external action', async () => {
  const ctx = await setup();
  const inbound = result({ resultId: 'result-crash', outcome: 'COMPLETED', classification: 'WISERR_COMPLETED' });
  await ingestWiserrReactivationSubmissionResult({ runtime: ctx.runtime, result: inbound, now: NOW });
  assert.equal(await state(ctx.store, ctx.campaignId), 'EXECUTING');
  const recovered = await ingestWiserrReactivationSubmissionResultAndAdvanceCampaign({ runtime: ctx.runtime, result: inbound, now: new Date('2026-08-18T20:01:00Z') });
  assert.equal(recovered.resultIdempotent, true);
  assert.equal(recovered.campaignState, 'OBSERVING');
});

test('illegal campaign/result combination refuses before result receipt or attempt mutation', async () => {
  const ctx = await setup();
  await stopDurableReactivationCampaign({ store: ctx.store, tenantId: 'tenant-1', campaignId: ctx.campaignId, reason: 'MANUAL_STOP', now: NOW });
  const inbound = result({ resultId: 'result-illegal', outcome: 'COMPLETED', classification: 'WISERR_COMPLETED' });
  await assert.rejects(() => ingestWiserrReactivationSubmissionResultAndAdvanceCampaign({ runtime: ctx.runtime, result: inbound, now: NOW }), /WISERR_SUBMISSION_CAMPAIGN_RESULT_STATE_CONFLICT:STOPPED/);
  assert.equal(await loadDurableWiserrSubmissionResult({ store: ctx.store, tenantId: 'tenant-1', resultId: inbound.resultId }), null);
  assert.equal((await loadDurableExecutionAttempt({ store: ctx.store, tenantId: 'tenant-1', attemptId: 'attempt-1' })).payload.state, 'SUBMITTING');
});
