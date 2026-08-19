import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import { readAndPersistWiserrGrowthSnapshot } from '../src/runtime/wiserr-snapshot-repository.mjs';
import { evaluateAndPersistCapacityBundle, buildCapacityExecutionProof } from '../src/runtime/capacity-bundle-repository.mjs';
import { evaluateAndPersistDurableReactivationOpportunity } from '../src/runtime/reactivation-opportunity-repository.mjs';
import { buildReactivationPlan } from '../src/reactivation/plan.mjs';
import {
  createDurableReactivationCampaign,
  submitDurableReactivationCampaignForApproval,
  approveDurableReactivationCampaign
} from '../src/runtime/reactivation-campaign-repository.mjs';
import {
  createDurableExperiment,
  approveDurableExperiment
} from '../src/runtime/experiment-repository.mjs';
import {
  createDurableDraftEnvelope,
  activateDurableActionEnvelope,
  revokeDurableActionEnvelope,
  loadDurableActionEnvelope
} from '../src/runtime/action-envelope-repository.mjs';
import { buildReactivationPolicyAction } from '../src/reactivation/action.mjs';
import { actionApprovalHash, sha256Canonical } from '../src/core/canonical.mjs';
import { evaluateAndPersistPolicyAuthorization } from '../src/runtime/policy-authorization-repository.mjs';
import {
  createDurableExecutionAttempt,
  markDurableExecutionSubmitting
} from '../src/runtime/execution-attempt-repository.mjs';
import { persistDurableWiserrReactivationCommand } from '../src/runtime/wiserr-reactivation-command-repository.mjs';
import { ingestWiserrReactivationSubmissionResult } from '../src/runtime/wiserr-submission-result-ingestion.mjs';
import { WISERR_REACTIVATION_SMS_DEPENDENCY_ID } from '../src/integrations/wiserr/reactivation-sms-authority.mjs';
import { ingestDurableBusinessOutcome } from '../src/runtime/business-outcome-repository.mjs';
import {
  buildAndPersistDurableGrowthRunManifest,
  loadDurableGrowthRunManifest,
  listDurableGrowthRunManifests
} from '../src/runtime/growth-run-repository.mjs';

const T0 = new Date('2026-08-18T21:00:00.000Z');
const FP = 'a'.repeat(64);
const RECEIPT = {
  schemaVersion: 1,
  dependencyId: 'wiserr-growth-snapshot-v1',
  system: 'WISERR_OS',
  repository: 'mottadavid/Wiserr-OS',
  contractName: 'wiserr-growth-snapshot',
  contractVersion: '1',
  status: 'CERTIFIED',
  validatedCommitSha: '1'.repeat(40),
  authorityFingerprint: FP,
  validatedAt: '2026-08-18T20:00:00.000Z',
  validUntil: null,
  guardedPaths: ['server/growth/growthSnapshotService.ts'],
  capabilities: { readGrowthSnapshot: true }
};

function snapshot() {
  return {
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    tenantId: 'tenant-1',
    generatedAt: '2026-08-18T20:59:00.000Z',
    completeness: 'COMPLETE_FOR_PURPOSE',
    capacity: { status: 'UNKNOWN', demandThrottleRecommended: true, reason: 'capacity supplied separately' },
    reactivation: {
      cohortDefinitionId: 'non-won-inactive-leads',
      cohortDefinitionVersion: '1:90d',
      dormantCount: 120,
      eligibleByChannel: { sms: 100, email: 0, whatsapp: 0 },
      suppressedCount: 20
    },
    capabilities: {
      reactivationSms: true,
      reactivationEmail: false,
      reactivationWhatsapp: false,
      lunaReplyHandling: false,
      bookingOutcomes: true
    }
  };
}

function capacityAuthority() {
  return {
    schemaVersion: 1,
    authorityId: 'capacity-authority-1',
    tenantId: 'tenant-1',
    sourceSystem: 'wiserr',
    sourceAuthority: 'wiserr://capacity/pilot',
    status: 'ACTIVE',
    validFrom: '2026-08-18T20:00:00.000Z',
    validUntil: '2026-08-19T20:00:00.000Z',
    scopeKeys: ['tenant:tenant-1:service:all'],
    permissions: { canAssertAvailability: true, canAssertConstraints: true },
    evidenceRef: 'wiserr://authority/capacity/pilot'
  };
}

function capacityEvidence() {
  return {
    schemaVersion: 1,
    evidenceId: 'capacity-evidence-1',
    tenantId: 'tenant-1',
    scopeKey: 'tenant:tenant-1:service:all',
    sourceSystem: 'wiserr',
    sourceAuthority: 'wiserr://capacity/pilot',
    asOf: '2026-08-18T20:58:00.000Z',
    validUntil: '2026-08-18T23:00:00.000Z',
    completeness: 'COMPLETE_FOR_PURPOSE',
    signals: [{ signalId: 'available-1', verdict: 'AVAILABLE', authoritative: true, sourceRef: 'wiserr://capacity/pilot/1' }]
  };
}

function delegation() {
  return {
    schemaVersion: 1,
    assertionId: 'delegation-1',
    tenantId: 'tenant-1',
    grantingActorId: 'owner-1',
    issuerSystem: 'wiserr',
    issuerAuthorityRef: 'wiserr://authority/owner-1',
    status: 'ACTIVE',
    validFrom: '2026-08-18T20:00:00.000Z',
    validUntil: '2026-08-20T20:00:00.000Z',
    allowedDelegateSubjectIds: ['growth-worker'],
    actionFamilies: ['REACTIVATION'],
    allowedAutonomyLevels: ['L3_APPROVAL_REQUIRED'],
    scopes: { channels: ['sms'], accountIds: ['wiserr-primary'], geographies: ['tampa-fl'] },
    limitCeilings: { maxSpendUsdPerDay: 100, maxSpendUsdTotal: 500, maxChangePercent: 25, maxAttempts: 1, maxRecipients: 200 },
    canActivateEnvelopes: true,
    canRevokeEnvelopes: true,
    evidenceRef: 'wiserr://authority/owner-1'
  };
}

function executionRuntime(store) {
  return Object.freeze({ schemaVersion: 1, tenantId: 'tenant-1', mode: 'EXECUTION_ENABLED', executionEnabled: true, executionBlockers: [], executionStore: store });
}

async function buildPersistedLoop() {
  const store = new AtomicInMemoryRuntimeStore();
  await readAndPersistWiserrGrowthSnapshot({
    store,
    receipt: RECEIPT,
    currentCommitSha: RECEIPT.validatedCommitSha,
    currentAuthorityFingerprint: FP,
    tenantId: 'tenant-1',
    dormantDays: 90,
    transport: async () => structuredClone(snapshot()),
    now: T0
  });
  const capacityBundle = await evaluateAndPersistCapacityBundle({ store, evidence: capacityEvidence(), authority: capacityAuthority(), now: T0 });
  const capacityProof = buildCapacityExecutionProof(capacityBundle.record, { now: T0 });
  const opportunityEvaluation = await evaluateAndPersistDurableReactivationOpportunity({
    store,
    tenantId: 'tenant-1',
    snapshotId: 'snapshot-1',
    capacityEvidenceId: 'capacity-evidence-1',
    capacityAuthorityId: 'capacity-authority-1',
    now: T0
  });
  assert.equal(opportunityEvaluation.result.decision, 'OPPORTUNITY');
  const opportunity = opportunityEvaluation.result.opportunity;

  const plan = buildReactivationPlan({
    opportunity,
    snapshot: snapshot(),
    channel: 'sms',
    message: { strategy: 'helpful_reactivation', body: 'PRIVATE APPROVED MESSAGE', version: 'v1' },
    requestedMaxRecipients: 50,
    observationHorizonHours: 72,
    maxAttempts: 1
  });
  const createdCampaign = await createDurableReactivationCampaign({ store, plan, now: T0 });
  const readyCampaign = await submitDurableReactivationCampaignForApproval({
    store, tenantId: 'tenant-1', campaignId: createdCampaign.record.recordId, now: new Date('2026-08-18T21:01:00Z')
  });
  const approvedCampaign = await approveDurableReactivationCampaign({
    store,
    tenantId: 'tenant-1',
    campaignId: readyCampaign.recordId,
    approvalId: 'campaign-approval-1',
    approvedBy: 'owner-1',
    approvedPlanHash: plan.approvalHash,
    approvalAuthorityRef: 'wiserr://authority/owner-1/reactivation',
    approvedAt: new Date('2026-08-18T21:02:00Z'),
    expiresAt: new Date('2026-08-19T21:02:00Z')
  });

  const draftExperiment = await createDurableExperiment({
    store,
    input: {
      experimentId: 'experiment-1',
      tenantId: 'tenant-1',
      opportunityId: opportunity.opportunityId,
      businessSnapshotId: 'snapshot-1',
      hypothesis: 'Bounded reactivation can create bookings without breaching opt-out guardrails.',
      actionPlanRef: plan.planId,
      actionPlanHash: plan.approvalHash,
      primaryMetric: 'booking_rate',
      successCriterion: { operator: 'GTE', threshold: 0.05 },
      guardrails: [{ metric: 'opt_out_rate', operator: 'GTE', threshold: 0.1 }],
      minimumSampleSize: 25,
      observationHorizonHours: 72,
      maxExposure: 50,
      maxSpendUsd: 25,
      createdAt: T0
    },
    now: T0
  });
  const approvedExperiment = await approveDurableExperiment({
    store,
    tenantId: 'tenant-1',
    experimentId: draftExperiment.record.recordId,
    actorId: 'owner-1',
    approvalAuthorityRef: 'wiserr://authority/owner-1/experiment',
    now: new Date('2026-08-18T21:02:00Z')
  });

  const action = buildReactivationPolicyAction({
    plan,
    campaignApproval: approvedCampaign.payload.approval,
    actionId: 'action-1',
    requestedBy: 'growth-worker',
    experimentId: approvedExperiment.payload.experimentId,
    accountId: 'wiserr-primary',
    geography: 'tampa-fl',
    expectedSpendUsd: 10,
    requestedAt: new Date('2026-08-18T21:03:00Z')
  });

  const draftEnvelope = await createDurableDraftEnvelope({
    store,
    input: {
      envelopeId: 'envelope-1', tenantId: 'tenant-1', actionFamily: 'REACTIVATION', delegateSubjectId: 'growth-worker',
      autonomyLevel: 'L3_APPROVAL_REQUIRED', validFrom: '2026-08-18T20:00:00.000Z', validUntil: '2026-08-19T20:00:00.000Z',
      channels: ['sms'], accountIds: ['wiserr-primary'], geographies: ['tampa-fl'],
      limits: { maxAttempts: 1, maxSpendUsdPerDay: 50, maxSpendUsdTotal: 100, maxChangePercent: 10, maxRecipients: 50 },
      requiresApproval: true, approvalId: approvedCampaign.payload.approval.approvalId, approvedActionHash: actionApprovalHash(action)
    },
    now: T0
  });
  const activeEnvelope = await activateDurableActionEnvelope({
    store,
    tenantId: 'tenant-1', envelopeId: draftEnvelope.record.recordId,
    assertion: delegation(), actorId: 'owner-1', now: new Date('2026-08-18T21:03:00Z')
  });

  const businessState = {
    tenantId: 'tenant-1',
    completeness: 'COMPLETE_FOR_PURPOSE',
    capacity: { status: 'AVAILABLE', demandThrottleRecommended: false }
  };
  const policy = await evaluateAndPersistPolicyAuthorization({
    store,
    action,
    envelope: activeEnvelope.payload,
    businessState,
    now: new Date('2026-08-18T21:04:00Z'),
    receiptId: 'policy-receipt-1'
  });
  assert.equal(policy.decision.decision, 'ALLOW');

  const attempt = await createDurableExecutionAttempt({ store, action, maxAttempts: 1, now: new Date('2026-08-18T21:05:00Z') });
  const commandBody = {
    schemaVersion: 1,
    commandId: `wiserr-reactivation:tenant-1:${action.actionId}:attempt:1`,
    tenantId: 'tenant-1',
    actionId: action.actionId,
    actionHash: attempt.payload.actionHash,
    campaignId: approvedCampaign.recordId,
    opportunityId: plan.opportunityId,
    experimentId: approvedExperiment.payload.experimentId,
    planId: plan.planId,
    planApprovalHash: plan.approvalHash,
    campaignApprovalId: approvedCampaign.payload.approval.approvalId,
    policyReceiptId: policy.record.recordId,
    policyReceiptHash: policy.record.payload.receipt.receiptHash,
    envelopeId: activeEnvelope.recordId,
    envelopeHash: policy.record.payload.receipt.envelopeHash,
    attemptId: attempt.recordId,
    attemptNumber: attempt.payload.attemptNumber,
    idempotencyKey: attempt.payload.idempotencyKey,
    capacityBundleId: capacityProof.capacityBundleId,
    capacityProofHash: capacityProof.proofHash,
    capacitySemanticHash: capacityProof.capacitySemanticHash,
    capacityAuthorityHash: capacityProof.authorityHash,
    executionAuthorityDependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID,
    executionAuthorityLockFingerprint: '3'.repeat(64),
    originalBusinessSnapshotId: plan.businessSnapshotId,
    executionBusinessSnapshotId: 'snapshot-1',
    cohortDefinitionId: plan.cohort.definitionId,
    cohortDefinitionVersion: plan.cohort.definitionVersion,
    channel: plan.channel,
    accountId: action.accountId,
    geography: action.geography,
    maxRecipients: plan.cohort.plannedMaxRecipients,
    message: structuredClone(plan.message),
    frequencyPolicy: structuredClone(plan.frequencyPolicy)
  };
  const command = { ...commandBody, commandHash: sha256Canonical(commandBody) };
  await persistDurableWiserrReactivationCommand({ store, command, now: new Date('2026-08-18T21:05:30Z') });
  await markDurableExecutionSubmitting({ store, tenantId: 'tenant-1', attemptId: attempt.recordId, now: new Date('2026-08-18T21:06:00Z') });

  const submissionResult = {
    schemaVersion: 1,
    resultId: 'wiserr-result-completed-1',
    tenantId: 'tenant-1',
    commandId: command.commandId,
    attemptId: attempt.recordId,
    outcome: 'COMPLETED',
    classification: 'WISERR_COMPLETED',
    evidenceRef: 'wiserr://messaging/execution/result-1',
    externalExecutionId: 'wiserr-send-1',
    observedAt: '2026-08-18T21:08:00.000Z'
  };
  const ingested = await ingestWiserrReactivationSubmissionResult({ runtime: executionRuntime(store), result: submissionResult, now: new Date('2026-08-18T21:08:00Z') });
  const completedAttempt = ingested.attemptRecord;

  await ingestDurableBusinessOutcome({
    store,
    tenantId: 'tenant-1',
    correlationId: 'action-1',
    sourceSystem: 'wiserr',
    canonicalOutcomeId: 'booking-1',
    outcomeType: 'BOOKING',
    outcomeValue: { bookingId: 'booking-1' },
    attributionConfidence: 'DIRECT',
    attributionEvidence: ['wiserr://booking/booking-1', 'growth://action/action-1'],
    directCorrelationId: 'action-1',
    occurredAt: new Date('2026-08-18T21:30:00Z'),
    recordedAt: new Date('2026-08-18T21:31:00Z')
  });

  return {
    store,
    opportunityEvaluationId: opportunityEvaluation.record.recordId,
    campaignId: approvedCampaign.recordId,
    experimentId: approvedExperiment.recordId,
    envelopeId: activeEnvelope.recordId,
    policyReceiptId: policy.record.recordId,
    attemptId: completedAttempt.recordId,
    commandId: command.commandId,
    resultId: submissionResult.resultId
  };
}

function manifestInput(loop, now = new Date('2026-08-18T21:32:00Z')) {
  return {
    store: loop.store,
    tenantId: 'tenant-1',
    snapshotId: 'snapshot-1',
    opportunityEvaluationId: loop.opportunityEvaluationId,
    campaignId: loop.campaignId,
    experimentId: loop.experimentId,
    envelopeId: loop.envelopeId,
    policyReceiptId: loop.policyReceiptId,
    attemptId: loop.attemptId,
    now
  };
}

test('builds final durable run proof entirely from persisted authoritative records including transport evidence', async () => {
  const loop = await buildPersistedLoop();
  const result = await buildAndPersistDurableGrowthRunManifest(manifestInput(loop));
  assert.equal(result.manifest.actionId, 'action-1');
  assert.equal(result.manifest.attemptState, 'COMPLETED');
  assert.equal(result.manifest.outcomeEventIds.length, 1);
  assert.equal(result.record.payload.sourceProof.transport.command.commandId, loop.commandId);
  assert.equal(result.record.payload.sourceProof.transport.results.length, 1);
  assert.equal(result.record.payload.sourceProof.transport.results[0].outcome, 'COMPLETED');
  assert.match(result.record.payload.sourceProofHash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(result.record).includes('PRIVATE APPROVED MESSAGE'), false);

  const recovered = await loadDurableGrowthRunManifest({ store: loop.store, tenantId: 'tenant-1', runId: result.manifest.runId });
  assert.equal(recovered.payload.manifestHash, result.manifest.manifestHash);
  const byAction = await listDurableGrowthRunManifests({ store: loop.store, tenantId: 'tenant-1', actionId: 'action-1' });
  assert.equal(byAction.length, 1);
});

test('completed run cannot be sealed without its exact persisted execution command', async () => {
  const loop = await buildPersistedLoop();
  const key = loop.store.recordKey({ tenantId: 'tenant-1', recordType: 'wiserr_reactivation_command', recordId: loop.commandId });
  loop.store.records.delete(key);
  await assert.rejects(() => buildAndPersistDurableGrowthRunManifest(manifestInput(loop)), /DURABLE_GROWTH_RUN_EXECUTION_COMMAND_NOT_FOUND/);
});

test('completed run cannot be sealed without its canonical COMPLETED submission result', async () => {
  const loop = await buildPersistedLoop();
  const key = loop.store.recordKey({ tenantId: 'tenant-1', recordType: 'wiserr_submission_result', recordId: loop.resultId });
  loop.store.records.delete(key);
  await assert.rejects(() => buildAndPersistDurableGrowthRunManifest(manifestInput(loop)), /DURABLE_GROWTH_RUN_REQUIRED_SUBMISSION_RESULT_MISSING:COMPLETED/);
});

test('later revocation of the live envelope does not invalidate the frozen execution authority proof', async () => {
  const loop = await buildPersistedLoop();
  await revokeDurableActionEnvelope({
    store: loop.store,
    tenantId: 'tenant-1', envelopeId: loop.envelopeId,
    assertion: delegation(), actorId: 'owner-1', reason: 'campaign completed',
    now: new Date('2026-08-18T21:40:00Z')
  });
  const current = await loadDurableActionEnvelope({ store: loop.store, tenantId: 'tenant-1', envelopeId: loop.envelopeId });
  assert.equal(current.payload.status, 'REVOKED');

  const result = await buildAndPersistDurableGrowthRunManifest(manifestInput(loop, new Date('2026-08-18T21:41:00Z')));
  assert.equal(result.manifest.envelopeId, 'envelope-1');
  assert.equal(result.manifest.attemptState, 'COMPLETED');
});

test('same run ID cannot be rebuilt with changed durable outcome semantics', async () => {
  const loop = await buildPersistedLoop();
  const first = await buildAndPersistDurableGrowthRunManifest(manifestInput(loop));
  await ingestDurableBusinessOutcome({
    store: loop.store,
    tenantId: 'tenant-1', correlationId: 'action-1', sourceSystem: 'wiserr', canonicalOutcomeId: 'booking-2',
    outcomeType: 'BOOKING', outcomeValue: { bookingId: 'booking-2' }, attributionConfidence: 'DIRECT',
    attributionEvidence: ['wiserr://booking/booking-2', 'growth://action/action-1'], directCorrelationId: 'action-1',
    occurredAt: new Date('2026-08-18T21:50:00Z'), recordedAt: new Date('2026-08-18T21:51:00Z')
  });
  await assert.rejects(
    () => buildAndPersistDurableGrowthRunManifest({ ...manifestInput(loop, new Date('2026-08-18T21:52:00Z')), runId: first.manifest.runId }),
    /DURABLE_GROWTH_RUN_MANIFEST_CONFLICT/
  );
});
