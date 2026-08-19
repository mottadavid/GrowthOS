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
import {
  persistDurableWiserrReactivationCommand,
  loadDurableWiserrReactivationCommand,
  listDurableWiserrReactivationCommands,
  assertDurableWiserrReactivationCommandMatches
} from '../src/runtime/wiserr-reactivation-command-repository.mjs';
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
    reactivation: {
      cohortDefinitionId: 'dormant-leads',
      cohortDefinitionVersion: 'v1',
      dormantCount: 100,
      suppressedCount: 20,
      eligibleByChannel: { sms: 80, email: 0, whatsapp: 0 }
    },
    capabilities: {
      reactivationSms: false,
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
    message: { strategy: 'return-help', body: 'PRIVATE CUSTOMER MESSAGE', version: 'v1' },
    requestedMaxRecipients: 50,
    maxAttempts: 1
  });
}

async function approvedCampaign(store) {
  const p = plan();
  const created = await createDurableReactivationCampaign({ store, plan: p, now: NOW });
  const ready = await submitDurableReactivationCampaignForApproval({ store, tenantId: 'tenant-1', campaignId: created.record.recordId, now: NOW });
  const approved = await approveDurableReactivationCampaign({
    store,
    tenantId: 'tenant-1',
    campaignId: ready.recordId,
    approvalId: 'approval-1',
    approvedBy: 'owner-1',
    approvedPlanHash: p.approvalHash,
    approvalAuthorityRef: 'wiserr://authority/owner-1/reactivation',
    approvedAt: NOW
  });
  return approved;
}

function commandFor(campaignRecord, overrides = {}) {
  const campaign = campaignRecord.payload;
  const p = campaign.plan;
  const body = {
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
    idempotencyKey: 'growthos:tenant-1:action-1:attempt:1',
    capacityBundleId: 'capacity-bundle-1',
    capacityProofHash: 'd'.repeat(64),
    capacitySemanticHash: 'e'.repeat(64),
    capacityAuthorityHash: 'f'.repeat(64),
    executionAuthorityDependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID,
    executionAuthorityLockFingerprint: '1'.repeat(64),
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
  return { ...body, commandHash: sha256Canonical(body) };
}

test('exact command persists once and exact replay is idempotent', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const campaign = await approvedCampaign(store);
  const command = commandFor(campaign);
  const first = await persistDurableWiserrReactivationCommand({ store, command, now: NOW });
  const second = await persistDurableWiserrReactivationCommand({ store, command: structuredClone(command), now: new Date('2026-08-18T20:01:00Z') });
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.record.recordId, command.commandId);
  assert.equal(first.record.indexKey, command.actionId);
  assert.equal(assertDurableWiserrReactivationCommandMatches(first.record, command), true);
});

test('same command ID cannot be reused with changed authority or payload', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const campaign = await approvedCampaign(store);
  const command = commandFor(campaign);
  await persistDurableWiserrReactivationCommand({ store, command, now: NOW });
  const changedBody = { ...structuredClone(command), capacityProofHash: '2'.repeat(64) };
  delete changedBody.commandHash;
  const changed = { ...changedBody, commandHash: sha256Canonical(changedBody) };
  await assert.rejects(() => persistDurableWiserrReactivationCommand({ store, command: changed, now: NOW }), /DURABLE_WISERR_COMMAND_CONFLICT/);
});

test('action-scoped recovery returns the exact immutable command', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const campaign = await approvedCampaign(store);
  const command = commandFor(campaign);
  await persistDurableWiserrReactivationCommand({ store, command, now: NOW });
  const found = await listDurableWiserrReactivationCommands({ store, tenantId: 'tenant-1', actionId: 'action-1' });
  assert.equal(found.length, 1);
  assert.equal(found[0].payload.command.commandHash, command.commandHash);
});

test('compact persistence event never copies private message content', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const campaign = await approvedCampaign(store);
  const command = commandFor(campaign);
  await persistDurableWiserrReactivationCommand({ store, command, now: NOW });
  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: 'action-1' });
  const event = events.find(item => item.eventType === 'growth.wiserr_reactivation_command.persisted');
  assert.ok(event);
  assert.equal(event.payload.commandHash, command.commandHash);
  assert.equal(JSON.stringify(event).includes('PRIVATE CUSTOMER MESSAGE'), false);
});

test('restart path starts campaign from persisted command ID without caller reconstructing command', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const campaign = await approvedCampaign(store);
  const command = commandFor(campaign);
  await persistDurableWiserrReactivationCommand({ store, command, now: NOW });

  const started = await startDurableReactivationCampaignFromPersistedCommand({
    store,
    tenantId: 'tenant-1',
    campaignId: campaign.recordId,
    commandId: command.commandId,
    now: new Date('2026-08-18T20:02:00Z')
  });
  assert.equal(started.payload.status, 'EXECUTING');
  assert.deepEqual(started.payload.attemptIds, ['attempt-1']);

  const recovered = await loadDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: campaign.recordId });
  assert.equal(recovered.payload.status, 'EXECUTING');
});

test('missing or cross-campaign persisted command refuses before campaign mutation', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const campaign = await approvedCampaign(store);
  await assert.rejects(() => startDurableReactivationCampaignFromPersistedCommand({ store, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: 'missing-command', now: NOW }), /DURABLE_WISERR_REACTIVATION_COMMAND_NOT_FOUND/);

  const command = commandFor(campaign, { campaignId: 'other-campaign' });
  await persistDurableWiserrReactivationCommand({ store, command, now: NOW });
  await assert.rejects(() => startDurableReactivationCampaignFromPersistedCommand({ store, tenantId: 'tenant-1', campaignId: campaign.recordId, commandId: command.commandId, now: NOW }), /DURABLE_WISERR_COMMAND_CAMPAIGN_MISMATCH/);
  const unchanged = await loadDurableReactivationCampaign({ store, tenantId: 'tenant-1', campaignId: campaign.recordId });
  assert.equal(unchanged.payload.status, 'APPROVED');
});

test('tampered persisted command record fails closed during recovery', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const campaign = await approvedCampaign(store);
  const command = commandFor(campaign);
  await persistDurableWiserrReactivationCommand({ store, command, now: NOW });
  const key = store.recordKey({ tenantId: 'tenant-1', recordType: 'wiserr_reactivation_command', recordId: command.commandId });
  store.records.get(key).payload.command.maxRecipients = 34;
  await assert.rejects(() => loadDurableWiserrReactivationCommand({ store, tenantId: 'tenant-1', commandId: command.commandId }), /DURABLE_WISERR_COMMAND_SEMANTIC_HASH_MISMATCH|RUNTIME_RECORD_PAYLOAD_HASH_MISMATCH/);
});
