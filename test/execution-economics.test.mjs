import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Canonical } from '../src/core/canonical.mjs';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import { persistDurableWiserrReactivationCommand } from '../src/runtime/wiserr-reactivation-command-repository.mjs';
import {
  persistDurableExecutionEconomics,
  loadDurableExecutionEconomics,
  listDurableExecutionEconomics,
  summarizeDurableExecutionEconomics,
  validateExecutionEconomicsObservation
} from '../src/runtime/execution-economics-repository.mjs';
import { WISERR_REACTIVATION_SMS_DEPENDENCY_ID } from '../src/integrations/wiserr/reactivation-sms-authority.mjs';

const NOW = new Date('2026-08-18T21:00:00.000Z');

function command(overrides = {}) {
  const body = {
    schemaVersion: 1,
    commandId: 'command-1', tenantId: 'tenant-1', actionId: 'action-1', actionHash: 'a'.repeat(64),
    campaignId: 'campaign-1', opportunityId: 'opp-1', experimentId: 'experiment-1', planId: 'plan-1',
    planApprovalHash: 'b'.repeat(64), campaignApprovalId: 'approval-1', policyReceiptId: 'policy-1',
    policyReceiptHash: 'c'.repeat(64), envelopeId: 'envelope-1', envelopeHash: 'd'.repeat(64),
    attemptId: 'attempt-1', attemptNumber: 1, idempotencyKey: 'growthos:tenant-1:action-1:attempt:1',
    capacityBundleId: 'capacity-1', capacityProofHash: 'e'.repeat(64), capacitySemanticHash: 'f'.repeat(64),
    capacityAuthorityHash: '1'.repeat(64), executionAuthorityDependencyId: WISERR_REACTIVATION_SMS_DEPENDENCY_ID,
    executionAuthorityLockFingerprint: '2'.repeat(64), originalBusinessSnapshotId: 'snapshot-1',
    executionBusinessSnapshotId: 'snapshot-2', cohortDefinitionId: 'dormant-leads', cohortDefinitionVersion: 'v1',
    channel: 'sms', accountId: 'wiserr-primary', geography: 'tampa-fl', maxRecipients: 25,
    message: { strategy: 'return-help', body: 'PRIVATE CUSTOMER MESSAGE', version: 'v1' },
    frequencyPolicy: { maxAttempts: 1, minHoursBetweenAttempts: 24, stopOnReply: true, stopOnBooking: true, stopOnOptOut: true },
    ...overrides
  };
  return { ...body, commandHash: sha256Canonical(body) };
}

function attempt(overrides = {}) {
  return {
    schemaVersion: 1, attemptId: 'attempt-1', tenantId: 'tenant-1', actionId: 'action-1', actionHash: 'a'.repeat(64),
    attemptNumber: 1, idempotencyKey: 'growthos:tenant-1:action-1:attempt:1', state: 'SUBMITTING',
    createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), externalExecutionId: null,
    result: null, error: null, suppression: null, reconciliation: null, events: [], ...overrides
  };
}

function observation(overrides = {}) {
  return {
    schemaVersion: 1,
    economicsId: 'economics-1',
    tenantId: 'tenant-1',
    actionId: 'action-1',
    attemptId: 'attempt-1',
    commandId: 'command-1',
    metricType: 'PROVIDER_COST_MICROS_USD',
    metricValue: 125000,
    sourceSystem: 'wiserr',
    evidenceRef: 'wiserr://messaging/cost/result-1',
    observedAt: NOW.toISOString(),
    ...overrides
  };
}

async function setup({ attemptOverrides = {}, commandOverrides = {} } = {}) {
  const store = new AtomicInMemoryRuntimeStore();
  const cmd = command(commandOverrides);
  await persistDurableWiserrReactivationCommand({ store, command: cmd, now: NOW });
  const att = attempt(attemptOverrides);
  await store.putRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: att.attemptId, indexKey: att.actionId, payload: att, expectedRevision: 0, now: NOW });
  return store;
}

test('measured execution economics persist immutably and summarize by additive metric', async () => {
  const store = await setup();
  await persistDurableExecutionEconomics({ store, observation: observation(), now: NOW });
  await persistDurableExecutionEconomics({
    store,
    observation: observation({ economicsId: 'economics-2', metricType: 'OPERATOR_TIME_MS', metricValue: 4200, evidenceRef: 'growthos://operator-timer/action-1' }),
    now: NOW
  });
  const summary = await summarizeDurableExecutionEconomics({ store, tenantId: 'tenant-1', attemptId: 'attempt-1' });
  assert.equal(summary.observationCount, 2);
  assert.deepEqual(summary.metrics.PROVIDER_COST_MICROS_USD, { observationCount: 1, knownTotal: 125000 });
  assert.deepEqual(summary.metrics.OPERATOR_TIME_MS, { observationCount: 1, knownTotal: 4200 });
  assert.deepEqual(summary.metrics.MODEL_COST_MICROS_USD, { observationCount: 0, knownTotal: null });
  assert.deepEqual(summary.metrics.COMPUTE_TIME_MS, { observationCount: 0, knownTotal: null });
});

test('explicit measured zero remains zero while an unobserved metric remains unknown', async () => {
  const store = await setup();
  await persistDurableExecutionEconomics({
    store,
    observation: observation({ metricValue: 0, evidenceRef: 'wiserr://messaging/cost/free-tier-1' }),
    now: NOW
  });
  const summary = await summarizeDurableExecutionEconomics({ store, tenantId: 'tenant-1', attemptId: 'attempt-1' });
  assert.equal(summary.metrics.PROVIDER_COST_MICROS_USD.knownTotal, 0);
  assert.equal(summary.metrics.MODEL_COST_MICROS_USD.knownTotal, null);
});

test('same economics ID is idempotent only for exact semantics', async () => {
  const store = await setup();
  const first = await persistDurableExecutionEconomics({ store, observation: observation(), now: NOW });
  const second = await persistDurableExecutionEconomics({ store, observation: structuredClone(observation()), now: NOW });
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  await assert.rejects(
    () => persistDurableExecutionEconomics({ store, observation: observation({ metricValue: 125001 }), now: NOW }),
    /DURABLE_EXECUTION_ECONOMICS_CONFLICT/
  );
});

test('economics evidence must match the exact durable command and attempt identity', async () => {
  const store = await setup();
  await assert.rejects(
    () => persistDurableExecutionEconomics({ store, observation: observation({ actionId: 'other-action' }), now: NOW }),
    /EXECUTION_ECONOMICS_AUTHORITY_MISMATCH/
  );
  await assert.rejects(
    () => persistDurableExecutionEconomics({ store, observation: observation({ commandId: 'missing-command' }), now: NOW }),
    /EXECUTION_ECONOMICS_COMMAND_NOT_FOUND/
  );
});

test('economics cannot be recorded before the attempt reaches the external submission boundary', async () => {
  const store = await setup({ attemptOverrides: { state: 'CREATED' } });
  await assert.rejects(
    () => persistDurableExecutionEconomics({ store, observation: observation(), now: NOW }),
    /EXECUTION_ECONOMICS_ATTEMPT_NOT_SUBMITTED/
  );
});

test('economics records are attempt-scoped, recoverable, and privacy bounded', async () => {
  const store = await setup();
  const saved = await persistDurableExecutionEconomics({ store, observation: observation(), now: NOW });
  const loaded = await loadDurableExecutionEconomics({ store, tenantId: 'tenant-1', economicsId: 'economics-1' });
  assert.equal(loaded.payload.semanticHash, saved.record.payload.semanticHash);
  const listed = await listDurableExecutionEconomics({ store, tenantId: 'tenant-1', attemptId: 'attempt-1' });
  assert.equal(listed.length, 1);
  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: 'attempt-1' });
  assert.equal(JSON.stringify(events).includes('PRIVATE CUSTOMER MESSAGE'), false);
  for (const forbidden of [
    { message: 'private' },
    { recipient: '+15551234567' },
    { providerPayload: { raw: 'private' } },
    { contact: { id: 'lead-1' } }
  ]) {
    assert.throws(() => validateExecutionEconomicsObservation(observation(forbidden)), /must not embed/);
  }
});
