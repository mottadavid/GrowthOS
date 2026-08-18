import { InMemoryRuntimeStore } from './store.mjs';
import { PostgresRuntimeStore } from './postgres-store.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function runtimeError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeMutation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('mutation must be an object.');
  const tenantId = requiredString(input.tenantId, 'mutation.tenantId');
  const recordType = requiredString(input.recordType, 'mutation.recordType');
  const recordId = requiredString(input.recordId, 'mutation.recordId');
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new Error('mutation.expectedRevision must be a non-negative integer.');
  }
  if (input.payload === undefined) throw new Error('mutation.payload is required.');
  if (!input.event || typeof input.event !== 'object' || Array.isArray(input.event)) throw new Error('mutation.event is required.');
  requiredString(input.event.eventId, 'mutation.event.eventId');
  requiredString(input.event.eventType, 'mutation.event.eventType');
  if (input.event.tenantId !== undefined && input.event.tenantId !== tenantId) {
    throw runtimeError('RUNTIME_MUTATION_EVENT_TENANT_MISMATCH');
  }
  return {
    tenantId,
    recordType,
    recordId,
    expectedRevision: input.expectedRevision,
    payload: clone(input.payload),
    now: input.now ?? new Date(),
    event: {
      ...clone(input.event),
      tenantId
    }
  };
}

async function executeMutation(store, mutation) {
  const record = await store.putRecord({
    tenantId: mutation.tenantId,
    recordType: mutation.recordType,
    recordId: mutation.recordId,
    payload: mutation.payload,
    expectedRevision: mutation.expectedRevision,
    now: mutation.now
  });

  const appended = await store.appendEvent({
    eventId: mutation.event.eventId,
    tenantId: mutation.tenantId,
    eventType: mutation.event.eventType,
    payload: mutation.event.payload ?? {},
    occurredAt: mutation.event.occurredAt ?? mutation.now,
    recordedAt: mutation.event.recordedAt ?? mutation.now,
    correlationId: mutation.event.correlationId ?? null,
    causationId: mutation.event.causationId ?? null
  });

  return { record, event: appended.event, eventIdempotent: appended.idempotent };
}

export class AtomicInMemoryRuntimeStore extends InMemoryRuntimeStore {
  async mutateRecordAndAppendEvent(input) {
    const mutation = normalizeMutation(input);
    const recordsBefore = new Map([...this.records.entries()].map(([key, value]) => [key, clone(value)]));
    const eventsBefore = new Map([...this.events.entries()].map(([key, value]) => [key, clone(value)]));
    try {
      return await executeMutation(this, mutation);
    } catch (error) {
      this.records = recordsBefore;
      this.events = eventsBefore;
      throw error;
    }
  }
}

export class AtomicPostgresRuntimeStore extends PostgresRuntimeStore {
  constructor({ query, withTransaction }) {
    super({ query });
    if (typeof withTransaction !== 'function') {
      throw new Error('AtomicPostgresRuntimeStore requires withTransaction(callback).');
    }
    this.withTransaction = withTransaction;
  }

  async mutateRecordAndAppendEvent(input) {
    const mutation = normalizeMutation(input);
    return this.withTransaction(async (transactionQuery) => {
      if (typeof transactionQuery !== 'function') {
        throw runtimeError('RUNTIME_TRANSACTION_QUERY_UNAVAILABLE');
      }
      const transactionStore = new PostgresRuntimeStore({ query: transactionQuery });
      return executeMutation(transactionStore, mutation);
    });
  }
}

export async function mutateAuthoritativeRuntimeState({ store, ...mutation }) {
  if (!store || typeof store.mutateRecordAndAppendEvent !== 'function') {
    throw runtimeError('RUNTIME_ATOMIC_MUTATION_REQUIRED');
  }
  return store.mutateRecordAndAppendEvent(mutation);
}
