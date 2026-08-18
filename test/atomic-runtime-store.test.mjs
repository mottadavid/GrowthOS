import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AtomicInMemoryRuntimeStore,
  AtomicPostgresRuntimeStore,
  mutateAuthoritativeRuntimeState
} from '../src/runtime/atomic-store.mjs';

const T0 = new Date('2026-08-18T20:00:00.000Z');
const T1 = new Date('2026-08-18T20:01:00.000Z');

function mutation(overrides = {}) {
  return {
    tenantId: 'tenant-1',
    recordType: 'campaign',
    recordId: 'campaign-1',
    payload: { status: 'EXECUTING' },
    expectedRevision: 0,
    now: T0,
    event: {
      eventId: 'event-1',
      eventType: 'growth.campaign.executing',
      payload: { status: 'EXECUTING' },
      correlationId: 'campaign-1'
    },
    ...overrides
  };
}

test('authoritative mutation requires an atomic-capable store', async () => {
  await assert.rejects(
    () => mutateAuthoritativeRuntimeState({
      store: {},
      ...mutation()
    }),
    error => error.code === 'RUNTIME_ATOMIC_MUTATION_REQUIRED'
  );
});

test('in-memory atomic mutation writes state and event together', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const result = await mutateAuthoritativeRuntimeState({ store, ...mutation() });
  assert.equal(result.record.revision, 1);
  assert.equal(result.record.payload.status, 'EXECUTING');
  assert.equal(result.event.eventId, 'event-1');
  assert.equal(result.event.tenantId, 'tenant-1');

  const stored = await store.getRecord({ tenantId: 'tenant-1', recordType: 'campaign', recordId: 'campaign-1' });
  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: 'campaign-1' });
  assert.equal(stored.payload.status, 'EXECUTING');
  assert.equal(events.length, 1);
});

test('event failure rolls back the state mutation in memory', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await store.appendEvent({
    eventId: 'event-1',
    tenantId: 'tenant-1',
    eventType: 'growth.other',
    payload: { different: true },
    occurredAt: T0,
    recordedAt: T0,
    correlationId: 'campaign-1'
  });

  await assert.rejects(
    () => store.mutateRecordAndAppendEvent(mutation()),
    error => error.code === 'RUNTIME_EVENT_ID_CONFLICT'
  );

  const stored = await store.getRecord({ tenantId: 'tenant-1', recordType: 'campaign', recordId: 'campaign-1' });
  assert.equal(stored, null);
  const events = await store.listEvents({ tenantId: 'tenant-1', correlationId: 'campaign-1' });
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, 'growth.other');
});

test('revision conflict does not append an event', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await store.putRecord({
    tenantId: 'tenant-1', recordType: 'campaign', recordId: 'campaign-1',
    payload: { status: 'APPROVED' }, expectedRevision: 0, now: T0
  });

  await assert.rejects(
    () => store.mutateRecordAndAppendEvent(mutation({ expectedRevision: 0 })),
    error => error.code === 'RUNTIME_RECORD_REVISION_CONFLICT'
  );
  assert.equal((await store.listEvents({ tenantId: 'tenant-1' })).length, 0);
});

test('atomic mutation refuses a mismatched event tenant', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await assert.rejects(
    () => store.mutateRecordAndAppendEvent(mutation({
      event: { eventId: 'event-1', eventType: 'growth.campaign.executing', tenantId: 'tenant-2', payload: {} }
    })),
    error => error.code === 'RUNTIME_MUTATION_EVENT_TENANT_MISMATCH'
  );
});

test('postgres atomic store executes state and event through the same transaction query', async () => {
  const calls = [];
  let transactionInvocations = 0;
  const transactionQuery = async (text, values) => {
    calls.push({ text, values });
    if (/INSERT INTO growthos_records/.test(text)) {
      return {
        rows: [{
          tenant_id: values[0], record_type: values[1], record_id: values[2], revision: 1,
          payload: JSON.parse(values[3]), payload_hash: values[4], created_at: values[5], updated_at: values[5]
        }]
      };
    }
    if (/INSERT INTO growthos_events/.test(text)) {
      return {
        rows: [{
          event_id: values[0], tenant_id: values[1], event_type: values[2], occurred_at: values[3], recorded_at: values[4],
          correlation_id: values[5], causation_id: values[6], payload: JSON.parse(values[7]), payload_hash: values[8]
        }]
      };
    }
    throw new Error(`Unexpected SQL: ${text}`);
  };

  const store = new AtomicPostgresRuntimeStore({
    query: async () => { throw new Error('non-transaction query must not be used'); },
    withTransaction: async (callback) => {
      transactionInvocations += 1;
      return callback(transactionQuery);
    }
  });

  const result = await store.mutateRecordAndAppendEvent(mutation({ now: T1 }));
  assert.equal(transactionInvocations, 1);
  assert.equal(calls.length, 2);
  assert.match(calls[0].text, /growthos_records/);
  assert.match(calls[1].text, /growthos_events/);
  assert.equal(result.record.revision, 1);
  assert.equal(result.event.eventId, 'event-1');
});

test('postgres atomic store refuses a transaction wrapper that does not provide a query function', async () => {
  const store = new AtomicPostgresRuntimeStore({
    query: async () => ({ rows: [] }),
    withTransaction: async (callback) => callback(null)
  });
  await assert.rejects(
    () => store.mutateRecordAndAppendEvent(mutation()),
    error => error.code === 'RUNTIME_TRANSACTION_QUERY_UNAVAILABLE'
  );
});
