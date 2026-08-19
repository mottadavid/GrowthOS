import { createAtomicPostgresRuntimeStoreFromPool } from './postgres-transaction-adapter.mjs';
import { inspectTenantStartupReadiness } from './startup-readiness.mjs';

export const RUNTIME_MODES = Object.freeze({
  READ_ONLY: 'READ_ONLY',
  EXECUTION_ENABLED: 'EXECUTION_ENABLED'
});

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function createReadOnlyStoreView(store) {
  return Object.freeze({
    getRecord: store.getRecord.bind(store),
    listRecords: store.listRecords.bind(store),
    listEvents: store.listEvents.bind(store)
  });
}

export async function bootstrapTenantRuntime({
  pool,
  tenantId,
  executionRequested = false,
  now = new Date(),
  migrationDirectory
}) {
  requiredString(tenantId, 'tenantId');
  if (typeof executionRequested !== 'boolean') throw new Error('executionRequested must be boolean.');

  const store = createAtomicPostgresRuntimeStoreFromPool({ pool });
  const readiness = await inspectTenantStartupReadiness({
    pool,
    store,
    tenantId,
    now,
    ...(migrationDirectory ? { migrationDirectory } : {})
  });

  const executionEnabled = executionRequested === true && readiness.ready === true;
  return Object.freeze({
    schemaVersion: 1,
    tenantId,
    mode: executionEnabled ? RUNTIME_MODES.EXECUTION_ENABLED : RUNTIME_MODES.READ_ONLY,
    executionRequested,
    executionEnabled,
    readiness,
    readStore: createReadOnlyStoreView(store),
    executionStore: executionEnabled ? store : null
  });
}

export function assertExecutionRuntime(runtime) {
  if (!runtime || runtime.mode !== RUNTIME_MODES.EXECUTION_ENABLED || runtime.executionEnabled !== true || !runtime.executionStore) {
    const error = new Error('GROWTHOS_RUNTIME_EXECUTION_DISABLED');
    error.code = 'GROWTHOS_RUNTIME_EXECUTION_DISABLED';
    throw error;
  }
  return runtime.executionStore;
}
