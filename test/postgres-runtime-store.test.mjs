import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresRuntimeStore } from '../src/runtime/postgres-store.mjs';
import { runtimePayloadHash } from '../src/runtime/store.mjs';

const T0 = '2026-08-18T20:00:00.000Z';

function recordRow(overrides = {}) {
  const payload = overrides.payload ?? { status: 'ACTIVE' };
  return {
    tenant_id: 'tenant-1',
    record_type: 'envelope',
    record_id: 'env-1',
    revision: 1,
    payload,
    payload_hash: runtimePayloadHash(payload),
    created_at: T0,
    updated_at: T0,
    ...overrides
  };
}

function eventRow(overrides = {}) {
  const payload = overrides.payload ?? { decision: 'ALLOW' };
  return {
    event_id: 'event-1',
    tenant_id: 'tenant-1',
    event_type: 'growth.policy.decision',
    occurred_at: T0,
    recorded_at: T0,
    correlation_id: 'action-1',
    causation_id: null,
    payload,
    payload_hash: runtimePayloadHash(payload),
    ...overrides
  };
}

test('record reads are tenant/type/id scoped and verify payload hash', async () => {
  const calls = [];
  const store = new PostgresRuntimeStore({ query: async (text, values) => {
    calls.push({ text, values });
    return { rows: [recordRow()] };
  }});
  const record = await store.getRecord({ tenantId: 'tenant-1', recordType: 'envelope', recordId: 'env-1' });
  assert.equal(record.tenantId, 'tenant-1');
  assert.deepEqual(calls[0].values, ['tenant-1', 'envelope', 'env-1']);
  assert.match(calls[0].text, /tenant_id = \$1 AND record_type = \$2 AND record_id = \$3/);
});

test('tampered database record is rejected on read', async () => {
  const store = new PostgresRuntimeStore({ query: async () => ({
    rows: [recordRow({ payload: { status: 'MUTATED' }, payload_hash: '0'.repeat(64) })]
  })});
  await assert.rejects(
    () => store.getRecord({ tenantId: 'tenant-1', recordType: 'envelope', recordId: 'env-1' }),
    error => error.code === 'RUNTIME_RECORD_HASH_MISMATCH'
  );
});

test('create uses insert-on-conflict-do-nothing and refuses duplicate revision zero', async () => {
  let mode = 'success';
  const calls = [];
  const store = new PostgresRuntimeStore({ query: async (text, values) => {
    calls.push({ text, values });
    if (mode === 'conflict') return { rows: [] };
    return { rows: [recordRow({ payload: JSON.parse(values[3]) })] };
  }});
  const created = await store.putRecord({
    tenantId: 'tenant-1', recordType: 'envelope', recordId: 'env-1',
    payload: { status: 'ACTIVE' }, expectedRevision: 0, now: new Date(T0)
  });
  assert.equal(created.revision, 1);
  assert.match(calls[0].text, /ON CONFLICT .* DO NOTHING/s);

  mode = 'conflict';
  await assert.rejects(
    () => store.putRecord({
      tenantId: 'tenant-1', recordType: 'envelope', recordId: 'env-1',
      payload: { status: 'ACTIVE' }, expectedRevision: 0, now: new Date(T0)
    }),
    error => error.code === 'RUNTIME_RECORD_REVISION_CONFLICT'
  );
});

test('update uses compare-and-swap revision in SQL and never blind-upserts', async () => {
  const calls = [];
  const store = new PostgresRuntimeStore({ query: async (text, values) => {
    calls.push({ text, values });
    return { rows: [recordRow({ revision: 2, payload: JSON.parse(values[3]), updated_at: values[5] })] };
  }});
  const updated = await store.putRecord({
    tenantId: 'tenant-1', recordType: 'envelope', recordId: 'env-1',
    payload: { status: 'REVOKED' }, expectedRevision: 1, now: new Date('2026-08-18T20:01:00Z')
  });
  assert.equal(updated.revision, 2);
  assert.match(calls[0].text, /AND revision = \$7/);
  assert.doesNotMatch(calls[0].text, /ON CONFLICT/);
});

test('event duplicate becomes idempotent only when stored event exactly matches', async () => {
  let step = 0;
  const exact = eventRow();
  const store = new PostgresRuntimeStore({ query: async () => {
    step += 1;
    if (step === 1) return { rows: [] };
    return { rows: [exact] };
  }});
  const result = await store.appendEvent({
    eventId: 'event-1', tenantId: 'tenant-1', eventType: 'growth.policy.decision',
    payload: { decision: 'ALLOW' }, occurredAt: new Date(T0), recordedAt: new Date(T0), correlationId: 'action-1'
  });
  assert.equal(result.idempotent, true);
});

test('event duplicate with different content refuses same event ID', async () => {
  let step = 0;
  const store = new PostgresRuntimeStore({ query: async () => {
    step += 1;
    if (step === 1) return { rows: [] };
    return { rows: [eventRow({ payload: { decision: 'DENY' } })] };
  }});
  await assert.rejects(
    () => store.appendEvent({
      eventId: 'event-1', tenantId: 'tenant-1', eventType: 'growth.policy.decision',
      payload: { decision: 'ALLOW' }, occurredAt: new Date(T0), recordedAt: new Date(T0), correlationId: 'action-1'
    }),
    error => error.code === 'RUNTIME_EVENT_ID_CONFLICT'
  );
});

test('event listing always scopes by tenant and optional correlation ID', async () => {
  const calls = [];
  const store = new PostgresRuntimeStore({ query: async (text, values) => {
    calls.push({ text, values });
    return { rows: [eventRow()] };
  }});
  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: 'action-1', limit: 50 });
  assert.equal(events.length, 1);
  assert.deepEqual(calls[0].values, ['tenant-1', 'action-1', 50]);
  assert.match(calls[0].text, /WHERE tenant_id = \$1/);
});
