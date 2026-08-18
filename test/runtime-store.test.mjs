import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRuntimeStore, validateRuntimeRecord, validateRuntimeEvent } from '../src/runtime/store.mjs';

const T0 = new Date('2026-08-18T20:00:00.000Z');
const T1 = new Date('2026-08-18T20:01:00.000Z');

test('records are create-only at revision zero then compare-and-swap updated', async () => {
  const store = new InMemoryRuntimeStore();
  const created = await store.putRecord({
    tenantId: 'tenant-1', recordType: 'campaign', recordId: 'campaign-1',
    payload: { status: 'APPROVED' }, expectedRevision: 0, now: T0
  });
  assert.equal(created.revision, 1);
  assert.equal(validateRuntimeRecord(created), created);

  const updated = await store.putRecord({
    tenantId: 'tenant-1', recordType: 'campaign', recordId: 'campaign-1',
    payload: { status: 'EXECUTING' }, expectedRevision: 1, now: T1
  });
  assert.equal(updated.revision, 2);
  assert.equal(updated.createdAt, T0.toISOString());
  assert.equal(updated.updatedAt, T1.toISOString());

  await assert.rejects(
    () => store.putRecord({
      tenantId: 'tenant-1', recordType: 'campaign', recordId: 'campaign-1',
      payload: { status: 'STOPPED' }, expectedRevision: 1, now: T1
    }),
    error => error.code === 'RUNTIME_RECORD_REVISION_CONFLICT'
  );
});

test('blind overwrite and duplicate create are refused', async () => {
  const store = new InMemoryRuntimeStore();
  await store.putRecord({
    tenantId: 'tenant-1', recordType: 'envelope', recordId: 'env-1', payload: { status: 'ACTIVE' }, expectedRevision: 0, now: T0
  });
  await assert.rejects(
    () => store.putRecord({
      tenantId: 'tenant-1', recordType: 'envelope', recordId: 'env-1', payload: { status: 'REVOKED' }, expectedRevision: 0, now: T1
    }),
    error => error.code === 'RUNTIME_RECORD_REVISION_CONFLICT'
  );
});

test('tenant identity is part of record key and reads cannot cross tenant boundaries', async () => {
  const store = new InMemoryRuntimeStore();
  await store.putRecord({
    tenantId: 'tenant-a', recordType: 'experiment', recordId: 'exp-1', payload: { state: 'RUNNING' }, expectedRevision: 0, now: T0
  });
  assert.equal(await store.getRecord({ tenantId: 'tenant-b', recordType: 'experiment', recordId: 'exp-1' }), null);
  assert.equal((await store.getRecord({ tenantId: 'tenant-a', recordType: 'experiment', recordId: 'exp-1' })).payload.state, 'RUNNING');
});

test('tenant-scoped record discovery supports recovery without cross-tenant enumeration', async () => {
  const store = new InMemoryRuntimeStore();
  await store.putRecord({ tenantId: 'tenant-1', recordType: 'campaign', recordId: 'c1', payload: { status: 'APPROVED' }, expectedRevision: 0, now: T0 });
  await store.putRecord({ tenantId: 'tenant-1', recordType: 'campaign', recordId: 'c2', payload: { status: 'EXECUTING' }, expectedRevision: 0, now: T1 });
  await store.putRecord({ tenantId: 'tenant-1', recordType: 'experiment', recordId: 'e1', payload: { state: 'RUNNING' }, expectedRevision: 0, now: T1 });
  await store.putRecord({ tenantId: 'tenant-2', recordType: 'campaign', recordId: 'foreign', payload: { status: 'APPROVED' }, expectedRevision: 0, now: T1 });

  const records = await store.listRecords({ tenantId: 'tenant-1', recordType: 'campaign' });
  assert.deepEqual(records.map(record => record.recordId), ['c2', 'c1']);
  assert.equal(records.every(record => record.tenantId === 'tenant-1' && record.recordType === 'campaign'), true);
});

test('recovery discovery verifies every returned record hash', async () => {
  const store = new InMemoryRuntimeStore();
  await store.putRecord({ tenantId: 'tenant-1', recordType: 'campaign', recordId: 'c1', payload: { status: 'APPROVED' }, expectedRevision: 0, now: T0 });
  const key = store.recordKey({ tenantId: 'tenant-1', recordType: 'campaign', recordId: 'c1' });
  store.records.get(key).payload.status = 'MUTATED';
  await assert.rejects(
    () => store.listRecords({ tenantId: 'tenant-1', recordType: 'campaign' }),
    error => error.code === 'RUNTIME_RECORD_HASH_MISMATCH'
  );
});

test('record payload hash is verified on every read', async () => {
  const store = new InMemoryRuntimeStore();
  await store.putRecord({
    tenantId: 'tenant-1', recordType: 'attempt', recordId: 'attempt-1', payload: { state: 'CREATED' }, expectedRevision: 0, now: T0
  });
  const key = store.recordKey({ tenantId: 'tenant-1', recordType: 'attempt', recordId: 'attempt-1' });
  store.records.get(key).payload.state = 'COMPLETED';
  await assert.rejects(
    () => store.getRecord({ tenantId: 'tenant-1', recordType: 'attempt', recordId: 'attempt-1' }),
    error => error.code === 'RUNTIME_RECORD_HASH_MISMATCH'
  );
});

test('append-only events are idempotent only for the exact same event', async () => {
  const store = new InMemoryRuntimeStore();
  const input = {
    eventId: 'event-1', tenantId: 'tenant-1', eventType: 'growth.policy.decision',
    payload: { decision: 'ALLOW' }, occurredAt: T0, recordedAt: T0,
    correlationId: 'action-1', causationId: null
  };
  const first = await store.appendEvent(input);
  const second = await store.appendEvent(input);
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(validateRuntimeEvent(second.event), second.event);

  await assert.rejects(
    () => store.appendEvent({ ...input, payload: { decision: 'DENY' } }),
    error => error.code === 'RUNTIME_EVENT_ID_CONFLICT'
  );
});

test('event listing is tenant scoped, correlation scoped, ordered, and bounded', async () => {
  const store = new InMemoryRuntimeStore();
  await store.appendEvent({ eventId: 'e2', tenantId: 'tenant-1', eventType: 'growth.execution.completed', payload: {}, occurredAt: T1, recordedAt: T1, correlationId: 'action-1' });
  await store.appendEvent({ eventId: 'e1', tenantId: 'tenant-1', eventType: 'growth.policy.decision', payload: {}, occurredAt: T0, recordedAt: T0, correlationId: 'action-1' });
  await store.appendEvent({ eventId: 'e3', tenantId: 'tenant-1', eventType: 'growth.other', payload: {}, occurredAt: T0, recordedAt: T0, correlationId: 'other' });
  await store.appendEvent({ eventId: 'e4', tenantId: 'tenant-2', eventType: 'growth.policy.decision', payload: {}, occurredAt: T0, recordedAt: T0, correlationId: 'action-1' });

  const actionEvents = await store.listEvents({ tenantId: 'tenant-1', correlationId: 'action-1' });
  assert.deepEqual(actionEvents.map(e => e.eventId), ['e1', 'e2']);
  const limited = await store.listEvents({ tenantId: 'tenant-1', limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0].tenantId, 'tenant-1');
});

test('event payload hash tampering is detected before listing returns data', async () => {
  const store = new InMemoryRuntimeStore();
  await store.appendEvent({ eventId: 'event-1', tenantId: 'tenant-1', eventType: 'growth.outcome', payload: { value: 1 }, occurredAt: T0, recordedAt: T0 });
  store.events.get('event-1').payload.value = 999;
  await assert.rejects(
    () => store.listEvents({ tenantId: 'tenant-1' }),
    error => error.code === 'RUNTIME_EVENT_HASH_MISMATCH'
  );
});
