import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import {
  durableBusinessOutcomeId,
  ingestDurableBusinessOutcome,
  loadDurableBusinessOutcome,
  listDurableBusinessOutcomes
} from '../src/runtime/business-outcome-repository.mjs';

const OCCURRED = new Date('2026-08-18T20:00:00.000Z');
const RECORDED = new Date('2026-08-18T20:00:05.000Z');

function input(overrides = {}) {
  return {
    tenantId: 'tenant-1',
    correlationId: 'action-1',
    sourceSystem: 'wiserr',
    canonicalOutcomeId: 'booking-123',
    outcomeType: 'BOOKING_CREATED',
    outcomeValue: { bookingValueUsd: 250, internalCustomerNote: 'PRIVATE OUTCOME DETAIL' },
    attributionConfidence: 'DIRECT',
    attributionEvidence: ['wiserr://booking/booking-123', 'growthos://action/action-1'],
    directCorrelationId: 'action-1',
    occurredAt: OCCURRED,
    recordedAt: RECORDED,
    ...overrides
  };
}

test('canonical outcome identity is deterministic across webhook deliveries', () => {
  const first = durableBusinessOutcomeId(input());
  const second = durableBusinessOutcomeId({ ...input(), recordedAt: new Date('2026-08-18T21:00:00Z') });
  assert.equal(first, second);
});

test('first ingestion persists canonical growth outcome and exact replay is idempotent', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const first = await ingestDurableBusinessOutcome({ store, ...input() });
  const second = await ingestDurableBusinessOutcome({ store, ...input({ recordedAt: new Date('2026-08-18T21:00:00Z') }) });
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.record.recordId, second.record.recordId);
  assert.equal(first.event.eventType, 'growth.business_outcome.observed');
  assert.equal(first.event.payload.canonicalOutcomeId, 'booking-123');
  assert.equal(first.event.attributionConfidence, 'DIRECT');
});

test('same canonical outcome ID with changed semantic outcome fails closed', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await ingestDurableBusinessOutcome({ store, ...input() });
  await assert.rejects(
    () => ingestDurableBusinessOutcome({
      store,
      ...input({ outcomeType: 'BOOKING_CANCELLED' })
    }),
    /DURABLE_BUSINESS_OUTCOME_CONFLICT/
  );
});

test('canonical outcome identity is source-system scoped', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const wiserr = await ingestDurableBusinessOutcome({ store, ...input() });
  const external = await ingestDurableBusinessOutcome({ store, ...input({ sourceSystem: 'external-crm' }) });
  assert.notEqual(wiserr.record.recordId, external.record.recordId);
});

test('correlation-scoped recovery returns only outcomes tied to that growth action', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await ingestDurableBusinessOutcome({ store, ...input() });
  await ingestDurableBusinessOutcome({
    store,
    ...input({ canonicalOutcomeId: 'booking-456', correlationId: 'action-2', directCorrelationId: 'action-2' })
  });
  const actionOne = await listDurableBusinessOutcomes({ store, tenantId: 'tenant-1', correlationId: 'action-1' });
  assert.equal(actionOne.length, 1);
  assert.equal(actionOne[0].payload.event.payload.canonicalOutcomeId, 'booking-123');
});

test('compact runtime evidence hashes outcome value instead of copying private outcome details', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const result = await ingestDurableBusinessOutcome({ store, ...input() });
  const runtimeEvents = await store.listEvents({ tenantId: 'tenant-1', correlationId: 'action-1' });
  assert.equal(runtimeEvents.length, 1);
  const serialized = JSON.stringify(runtimeEvents[0]);
  assert.equal(serialized.includes('PRIVATE OUTCOME DETAIL'), false);
  assert.match(runtimeEvents[0].payload.outcomeValueHash, /^[0-9a-f]{64}$/);

  const recovered = await loadDurableBusinessOutcome({
    store,
    tenantId: 'tenant-1',
    sourceSystem: 'wiserr',
    canonicalOutcomeId: 'booking-123'
  });
  assert.deepEqual(recovered.payload.event.payload.outcomeValue, result.event.payload.outcomeValue);
});

test('DIRECT outcome still requires canonical attribution evidence', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await assert.rejects(
    () => ingestDurableBusinessOutcome({ store, ...input({ attributionEvidence: [] }) }),
    /DIRECT attribution requires explicit evidence/
  );
});

test('UNATTRIBUTED outcome cannot carry a direct growth correlation claim', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  await assert.rejects(
    () => ingestDurableBusinessOutcome({
      store,
      ...input({ attributionConfidence: 'UNATTRIBUTED', directCorrelationId: 'action-1' })
    }),
    /UNATTRIBUTED outcome cannot carry a direct correlation ID/
  );
});

test('corrupt durable outcome secondary index fails closed on recovery', async () => {
  const store = new AtomicInMemoryRuntimeStore();
  const ingested = await ingestDurableBusinessOutcome({ store, ...input() });
  const key = store.recordKey({ tenantId: 'tenant-1', recordType: 'business_outcome', recordId: ingested.record.recordId });
  store.records.get(key).indexKey = 'action-forged';
  await assert.rejects(
    () => loadDurableBusinessOutcome({ store, tenantId: 'tenant-1', sourceSystem: 'wiserr', canonicalOutcomeId: 'booking-123' }),
    /DURABLE_BUSINESS_OUTCOME_IDENTITY_MISMATCH/
  );
});
