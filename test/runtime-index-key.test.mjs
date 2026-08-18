import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryRuntimeStore } from '../src/runtime/store.mjs';

const T0 = new Date('2026-08-18T20:00:00.000Z');
const T1 = new Date('2026-08-18T20:01:00.000Z');

test('secondary index remains tenant and record-type scoped', async () => {
  const store = new InMemoryRuntimeStore();
  await store.putRecord({ tenantId: 'tenant-a', recordType: 'execution_attempt', recordId: 'a1', indexKey: 'action-1', payload: { value: 1 }, expectedRevision: 0, now: T0 });
  await store.putRecord({ tenantId: 'tenant-a', recordType: 'campaign', recordId: 'c1', indexKey: 'action-1', payload: { value: 2 }, expectedRevision: 0, now: T0 });
  await store.putRecord({ tenantId: 'tenant-b', recordType: 'execution_attempt', recordId: 'b1', indexKey: 'action-1', payload: { value: 3 }, expectedRevision: 0, now: T0 });
  await store.putRecord({ tenantId: 'tenant-a', recordType: 'execution_attempt', recordId: 'a2', indexKey: 'action-2', payload: { value: 4 }, expectedRevision: 0, now: T1 });

  const records = await store.listRecords({ tenantId: 'tenant-a', recordType: 'execution_attempt', indexKey: 'action-1' });
  assert.deepEqual(records.map(record => record.recordId), ['a1']);
  assert.equal(records[0].indexKey, 'action-1');
});

test('secondary index is immutable after record creation', async () => {
  const store = new InMemoryRuntimeStore();
  await store.putRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: 'a1', indexKey: 'action-1', payload: { state: 'CREATED' }, expectedRevision: 0, now: T0 });

  await assert.rejects(
    () => store.putRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: 'a1', indexKey: 'action-2', payload: { state: 'SUBMITTING' }, expectedRevision: 1, now: T1 }),
    error => error.code === 'RUNTIME_RECORD_INDEX_KEY_IMMUTABLE'
  );

  const record = await store.getRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: 'a1' });
  assert.equal(record.indexKey, 'action-1');
  assert.equal(record.revision, 1);
});

test('omitting index key on update preserves the existing index', async () => {
  const store = new InMemoryRuntimeStore();
  await store.putRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: 'a1', indexKey: 'action-1', payload: { state: 'CREATED' }, expectedRevision: 0, now: T0 });
  const updated = await store.putRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: 'a1', payload: { state: 'SUBMITTING' }, expectedRevision: 1, now: T1 });
  assert.equal(updated.indexKey, 'action-1');
  assert.equal(updated.revision, 2);
});
