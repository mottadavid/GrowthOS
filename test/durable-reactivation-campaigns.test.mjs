import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Canonical } from '../src/core/canonical.mjs';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import { buildReactivationPlan } from '../src/reactivation/plan.mjs';
import { wiserrReactivationCommandHash } from '../src/reactivation/wiserr-command.mjs';
import {
  createDurableReactivationCampaign,
  loadDurableReactivationCampaign,
  listDurableReactivationCampaigns,
  submitDurableReactivationCampaignForApproval,
  approveDurableReactivationCampaign,
  startDurableReactivationCampaignFromCommand,
  markDurableReactivationCampaignObserving,
  markDurableReactivationCampaignReconciliationRequired,
  stopDurableReactivationCampaign,
  completeDurableReactivationCampaign
} from '../src/runtime/reactivation-campaign-repository.mjs';

const T0 = new Date('2026-08-18T20:00:00.000Z');

function snapshot() {
  return {
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    tenantId: 'tenant-1',
    generatedAt: T0.toISOString(),
    completeness: 'COMPLETE_FOR_PURPOSE',
    capacity: { status: 'AVAILABLE', demandThrottleRecommended: false },
    reactivation: {
      cohortDefinitionId: 'dormant-leads',
      cohortDefinitionVersion: 'v1',
      dormantCount: 100,
      suppressedCount: 20,
      eligibleByChannel: { sms: 80, email: 0, whatsapp: 0 }
    },
    capabilities: {
      reactivationSms: true,
      reactivationEmail: false,
      reactivationWhatsapp: false,
      lunaReplyHandling: false,
      bookingOutcomes: false
    }
  };
}

function opportunity() {
  return {
    opportunityId: 'opp-1',
    tenantId: 'tenant-1',
    businessSnapshotId: 'snapshot-1',
    type: 'DORMANT_LEAD_REACTIVATION'
  };
}

function plan() {
  return buildReactivationPlan({
    opportunity: opportunity(),
    snapshot: snapshot(),
    channel: 'sms',
    message: { strategy: 'direct-help', body: 'PRIVATE APPROVED MESSAGE', version: 'v1' },
    requestedMaxRecipients: 50,
    observationHorizonHours: 72,
    maxAttempts: 1
  });
}

async function approvedDurableCampaign(store) {
  const p = plan();
  const created = await createDurableReactivationCampaign({ store, plan: p, now: T0 });
  const ready = await submitDurableReactivationCampaignForApproval({
    store, tenantId: 'tenant-1', campaignId: created.record.recordId, now: new Date('2026-08-18T20:01:00Z')
  });
  const approved = await approveDurableReactivationCampaign({
    store,
    tenantId: 'tenant-1',
    campaignId: ready.recordId,
    approvalId: 'approval-1',
    approvedBy: 'owner-1',
    approvedPlanHash: p.approvalHash,
    approvalAuthorityRef: 'wiserr://authority/owner-1/reactivation',
    approvedAt: new Date('2026-08-18T20:02:00Z'),
    expiresAt: new Date('2026-08-19T20:02:00Z')
  });
  return { plan: p, record: approved };
}

function commandFor(campaignRecord, overrides = {}) {
  const campaign = campaignRecord.payload;
  const p = campaign.plan;
  const command = {
    schemaVersion: 1,
    commandId: 'wiserr-reactivation:tenant-1:action-1:attempt:1',
    tenantId: 'tenant-1',
    actionId: 'action-1',
    actionHash: 'a'.repeat(64),
    campaignId: campaign.campaignId,
    opportunityId: p.opportunityId,
    experimentId: 'experiment-1',
    planId: p.planId,
    planApprovalHash: p.approvalHash,
    campaignApprovalId: campaign.approval.approvalId,
    policyReceiptId: 'policy-1',
    policyReceiptHash: 'b'.repeat(64),
    envelopeId: 'envelope-1',
    envelopeHash: 'c'.repeat(64),
    attemptId: 'attempt-1',
    attemptNumber: 1,
    idempotencyKey: 'growthos:tenant-1:action-1:hash:attempt:1',
    originalBusinessSnapshotId: p.businessSnapshotId,
    executionBusinessSnapshotId: 'snapshot-execution-1',
    cohortDefinitionId: p.cohort.definitionId,
    cohortDefinitionVersion: p.cohort.definitionVersion,
    channel: p.channel,
    accountId: 'wiserr-primary',
    geography: 'tampa-fl',
    maxRecipients: 35,
    message: structuredClone(p.message),
    frequencyPolicy: structuredClone(p.frequencyPolicy),
    ...overrides
  };
  return { ...command, commandHash: sha256Canonical(command) };
}

test('campaign creation is deterministic and idempotent per exact approved plan', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const p = plan();
  const first = await createDurableReactivationCampaign({ store, plan: p, now: T0 });
  const second = await createDurableReactivationCampaign({ store, plan: p, now: new Date('2026-08-18T20:05:00Z') });
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.record.recordId, second.record.recordId);
  assert.equal(first.record.indexKey, p.approvalHash);

  const byPlan = await listDurableReactivationCampaigns({ store, tenantId: 'tenant-1', planApprovalHash: p.approvalHash });
  assert.equal(byPlan.length, 1);
});

test('durable approval requires an external authority reference and retains it', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const p = plan();
  const created = await createDurableReactivationCampaign({ store, plan: p, now: T0 });
  const ready = await submitDurableReactivationCampaignForApproval({ store, tenantId: 'tenant-1', campaignId: created.record.recordId, now: T0 });

  assert.throws(
    () => approveDurableReactivationCampaign({
      store, tenantId: 'tenant-1', campaignId: ready.recordId,
      approvalId: 'approval-1', approvedBy: 'owner-1', approvedPlanHash: p.approvalHash,
      approvalAuthorityRef: '', approvedAt: T0
    }),
    /approvalAuthorityRef/
  );

  const approved = await approveDurableReactivationCampaign({
    store, tenantId: 'tenant-1', campaignId: ready.recordId,
    approvalId: 'approval-1', approvedBy: 'owner-1', approvedPlanHash: p.approvalHash,
    approvalAuthorityRef: 'wiserr://authority/owner-1/reactivation', approvedAt: T0
  });
  assert.equal(approved.payload.status, 'APPROVED');
  assert.equal(approved.payload.approval.approvalAuthorityRef, 'wiserr://authority/owner-1/reactivation');
});

test('valid exact command moves durable approved campaign to executing and remains recoverable', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const { record } = await approvedDurableCampaign(store);
  const command = commandFor(record);
  assert.equal(wiserrReactivationCommandHash(command), command.commandHash);

  const executing = await startDurableReactivationCampaignFromCommand({
    store, tenantId: 'tenant-1', campaignId: record.recordId, command,
    now: new Date('2026-08-18T20:03:00Z')
  });
  assert.equal(executing.payload.status, 'EXECUTING');
  assert.deepEqual(executing.payload.attemptIds, ['attempt-1']);

  const recovered = await loadDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: record.recordId });
  assert.equal(recovered.payload.status, 'EXECUTING');

  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: record.recordId });
  const executionEvent = events.find(event => event.eventType === 'growth.reactivation_campaign.executing');
  assert.ok(executionEvent);
  assert.equal(executionEvent.payload.commandHash, command.commandHash);
  assert.equal(executionEvent.payload.dispatchMaxRecipients, 35);
  assert.equal(JSON.stringify(executionEvent).includes('PRIVATE APPROVED MESSAGE'), false);
});

test('self-consistent forged command still cannot change approved campaign semantics', async () => {
  const cases = [
    { name: 'message', change: command => ({ ...command, message: { ...command.message, body: 'FORGED BODY' } }), error: /MESSAGE_MISMATCH/ },
    { name: 'cohort', change: command => ({ ...command, cohortDefinitionVersion: 'v2' }), error: /COHORT_MISMATCH/ },
    { name: 'channel', change: command => ({ ...command, channel: 'email' }), error: /CHANNEL_MISMATCH/ },
    { name: 'snapshot', change: command => ({ ...command, originalBusinessSnapshotId: 'other-snapshot' }), error: /SNAPSHOT_MISMATCH/ },
    { name: 'recipients', change: command => ({ ...command, maxRecipients: 500 }), error: /RECIPIENT_CEILING_INVALID/ }
  ];

  for (const item of cases) {
    const store = new AtomicInMemoryRuntimeStore();
    const { record } = await approvedDurableCampaign(store);
    const base = commandFor(record);
    const changedBody = item.change(base);
    delete changedBody.commandHash;
    const forged = { ...changedBody, commandHash: sha256Canonical(changedBody) };
    assert.equal(wiserrReactivationCommandHash(forged), forged.commandHash, `${item.name} command should be internally valid`);
    await assert.rejects(
      () => startDurableReactivationCampaignFromCommand({ store, tenantId: 'tenant-1', campaignId: record.recordId, command: forged, now: new Date('2026-08-18T20:03:00Z') }),
      item.error
    );
    const unchanged = await loadDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: record.recordId });
    assert.equal(unchanged.payload.status, 'APPROVED');
  }
});

test('durable campaign survives executing to observing to completed lifecycle', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const { record } = await approvedDurableCampaign(store);
  const executing = await startDurableReactivationCampaignFromCommand({ store, tenantId: 'tenant-1', campaignId: record.recordId, command: commandFor(record), now: new Date('2026-08-18T20:03:00Z') });
  const observing = await markDurableReactivationCampaignObserving({ store, tenantId: 'tenant-1', campaignId: executing.recordId, now: new Date('2026-08-18T20:04:00Z') });
  const completed = await completeDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: observing.recordId, now: new Date('2026-08-18T21:00:00Z') });
  assert.equal(completed.payload.status, 'COMPLETED');
  const recovered = await loadDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: completed.recordId });
  assert.equal(recovered.payload.status, 'COMPLETED');
  assert.ok(recovered.payload.completedAt);
});

test('durable campaign preserves reconciliation and manual stop after restart', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const { record } = await approvedDurableCampaign(store);
  const executing = await startDurableReactivationCampaignFromCommand({ store, tenantId: 'tenant-1', campaignId: record.recordId, command: commandFor(record), now: new Date('2026-08-18T20:03:00Z') });
  const uncertain = await markDurableReactivationCampaignReconciliationRequired({
    store, tenantId: 'tenant-1', campaignId: executing.recordId, reason: 'provider outcome unknown', now: new Date('2026-08-18T20:04:00Z')
  });
  assert.equal(uncertain.payload.status, 'RECONCILIATION_REQUIRED');

  const recovered = await loadDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: uncertain.recordId });
  const stopped = await stopDurableReactivationCampaign({
    store, tenantId: 'tenant-1', campaignId: recovered.recordId, reason: 'operator stop until evidence resolved', now: new Date('2026-08-18T20:05:00Z')
  });
  assert.equal(stopped.payload.status, 'STOPPED');
});

test('tampered campaign plan or secondary index fails closed on recovery', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const created = await createDurableReactivationCampaign({ store, plan: plan(), now: T0 });
  const key = store.recordKey({ tenantId: 'tenant-1', recordType: 'reactivation_campaign', recordId: created.record.recordId });
  store.records.get(key).indexKey = 'wrong-plan-hash';
  await assert.rejects(
    () => loadDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: created.record.recordId }),
    /DURABLE_REACTIVATION_CAMPAIGN_IDENTITY_MISMATCH/
  );
});
