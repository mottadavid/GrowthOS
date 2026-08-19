import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import {
  executionEconomicsSemanticBody,
  ingestDurableExecutionEconomicsEvent,
  listDurableExecutionEconomicsEvents,
  summarizeExecutionEconomics
} from '../src/runtime/execution-economics-repository.mjs';

const NOW = new Date('2026-08-19T00:00:00.000Z');
function event(overrides = {}) {
  return {
    economicsEventId: 'econ-1', tenantId: 'tenant-1', kind: 'COST_USD', certainty: 'ACTUAL', amount: 2.5,
    category: 'sms_provider', correlation: { actionId: 'action-1', campaignId: 'campaign-1' }, sourceSystem: 'wiserr',
    evidenceRef: 'wiserr://messaging/cost/econ-1', estimateBasisRef: null, occurredAt: NOW.toISOString(), ...overrides
  };
}

test('actual event requires retained evidence and exact replay is idempotent', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  assert.throws(() => executionEconomicsSemanticBody(event({ evidenceRef: null })), /ACTUAL economics require evidenceRef/);
  const first = await ingestDurableExecutionEconomicsEvent({ store, event: event(), now: NOW });
  const second = await ingestDurableExecutionEconomicsEvent({ store, event: structuredClone(event()), now: NOW });
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
});

test('estimated event requires an explicit estimate basis and remains separate from actual spend', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const estimated = event({ economicsEventId: 'econ-est', certainty: 'ESTIMATED', amount: 5, evidenceRef: null, estimateBasisRef: 'pricing://twilio/us-sms-2026-08' });
  assert.throws(() => executionEconomicsSemanticBody({ ...estimated, estimateBasisRef: null }), /ESTIMATED economics require estimateBasisRef/);
  await ingestDurableExecutionEconomicsEvent({ store, event: event(), now: NOW });
  await ingestDurableExecutionEconomicsEvent({ store, event: estimated, now: NOW });
  const records = await listDurableExecutionEconomicsEvents({ store, tenantId: 'tenant-1', correlationId: 'action-1' });
  const summary = summarizeExecutionEconomics(records);
  assert.equal(summary.actualCostUsd, 2.5);
  assert.equal(summary.estimatedCostUsd, 5);
});

test('human minutes are tracked independently from money', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await ingestDurableExecutionEconomicsEvent({ store, event: event({ economicsEventId: 'human-1', kind: 'HUMAN_MINUTES', certainty: 'ACTUAL', amount: 12, category: 'operator_review', evidenceRef: 'growthos://operator-session/human-1' }), now: NOW });
  const summary = summarizeExecutionEconomics(await listDurableExecutionEconomicsEvents({ store, tenantId: 'tenant-1', correlationId: 'action-1' }));
  assert.equal(summary.actualHumanMinutes, 12);
  assert.equal(summary.actualCostUsd, 0);
});

test('same canonical economics ID cannot be reused with changed semantics', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await ingestDurableExecutionEconomicsEvent({ store, event: event(), now: NOW });
  await assert.rejects(() => ingestDurableExecutionEconomicsEvent({ store, event: event({ amount: 3 }), now: NOW }), /EXECUTION_ECONOMICS_EVENT_CONFLICT/);
});

test('recovery is tenant and primary-correlation scoped', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await ingestDurableExecutionEconomicsEvent({ store, event: event(), now: NOW });
  await ingestDurableExecutionEconomicsEvent({ store, event: event({ economicsEventId: 'other-action', correlation: { actionId: 'action-2' } }), now: NOW });
  const records = await listDurableExecutionEconomicsEvents({ store, tenantId: 'tenant-1', correlationId: 'action-1' });
  assert.equal(records.length, 1);
  assert.equal(records[0].payload.event.economicsEventId, 'econ-1');
});

test('compact evidence event does not copy source references or arbitrary private payload', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await ingestDurableExecutionEconomicsEvent({ store, event: event(), now: NOW });
  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: 'action-1' });
  const audit = events.find(item => item.eventType === 'growth.execution_economics.recorded');
  assert.ok(audit);
  const serialized = JSON.stringify(audit);
  assert.equal(serialized.includes('wiserr://messaging/cost/econ-1'), false);
  assert.equal(audit.payload.amount, 2.5);
  assert.equal(audit.payload.certainty, 'ACTUAL');
});
