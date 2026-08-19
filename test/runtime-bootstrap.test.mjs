import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverRuntimeMigrations } from '../src/runtime/migrations.mjs';
import { bootstrapTenantRuntime, assertExecutionRuntime, RUNTIME_MODES } from '../src/runtime/bootstrap.mjs';

const TABLES = ['growthos_records','growthos_events','growthos_schema_migrations'];
const COLUMNS = {
  growthos_records: ['tenant_id','record_type','record_id','index_key','revision','payload','payload_hash','created_at','updated_at'],
  growthos_events: ['event_id','tenant_id','event_type','occurred_at','recorded_at','correlation_id','causation_id','payload','payload_hash'],
  growthos_schema_migrations: ['migration_name','checksum','applied_at']
};
const INDEXES = [
  'growthos_records_pkey','growthos_records_tenant_type_updated_idx','growthos_records_tenant_type_index_key_idx',
  'growthos_events_pkey','growthos_events_tenant_recorded_idx','growthos_events_tenant_correlation_recorded_idx',
  'growthos_schema_migrations_pkey'
];

async function tempMigrations() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'growthos-bootstrap-'));
  await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;\n');
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function poolFor(migrations, { missingRecordsTable = false } = {}) {
  const client = {
    async query(text) {
      if (text.includes('current_database()')) return { rows: [{ database_name: 'growthos_test', schema_name: 'public', server_version: '16-test' }] };
      if (text.includes('FROM information_schema.tables')) return { rows: TABLES.filter(name => !(missingRecordsTable && name === 'growthos_records')).map(table_name => ({ table_name })) };
      if (text.includes('SELECT migration_name, checksum, applied_at')) return { rows: migrations.map(item => ({ migration_name: item.name, checksum: item.checksum, applied_at: '2026-08-19T02:00:00Z' })) };
      if (text.includes('FROM information_schema.columns')) return { rows: Object.entries(COLUMNS).flatMap(([table_name, cols]) => cols.map(column_name => ({ table_name, column_name }))) };
      if (text.includes('FROM pg_indexes')) return { rows: INDEXES.map(indexname => ({ indexname })) };
      if (text.includes("to_regclass('pg_temp.growthos_transaction_probe')")) return { rows: [{ regclass: null }] };
      if (text.includes('FROM growthos_records')) return { rows: [] };
      if (text.includes('FROM growthos_events')) return { rows: [] };
      return { rows: [] };
    },
    release() {}
  };
  return {
    async query(text, values) { return client.query(text, values); },
    async connect() { return client; }
  };
}

test('healthy runtime still defaults to READ_ONLY unless execution is explicitly requested', async () => {
  const temp = await tempMigrations();
  try {
    const migrations = await discoverRuntimeMigrations({ directory: temp.directory });
    const runtime = await bootstrapTenantRuntime({ pool: poolFor(migrations), tenantId: 'tenant-1', migrationDirectory: temp.directory });
    assert.equal(runtime.readiness.ready, true);
    assert.equal(runtime.mode, RUNTIME_MODES.READ_ONLY);
    assert.equal(runtime.executionRequested, false);
    assert.equal(runtime.executionEnabled, false);
    assert.equal(runtime.executionStore, null);
    assert.equal(typeof runtime.readStore.getRecord, 'function');
    assert.equal(typeof runtime.readStore.listRecords, 'function');
    assert.equal(typeof runtime.readStore.listEvents, 'function');
    assert.equal(runtime.readStore.putRecord, undefined);
    assert.equal(runtime.readStore.mutateRecordAndAppendEvent, undefined);
    assert.throws(() => assertExecutionRuntime(runtime), /GROWTHOS_RUNTIME_EXECUTION_DISABLED/);
  } finally { await temp.cleanup(); }
});

test('explicit execution request is refused when startup readiness fails', async () => {
  const temp = await tempMigrations();
  try {
    const migrations = await discoverRuntimeMigrations({ directory: temp.directory });
    const runtime = await bootstrapTenantRuntime({
      pool: poolFor(migrations, { missingRecordsTable: true }),
      tenantId: 'tenant-1',
      executionRequested: true,
      migrationDirectory: temp.directory
    });
    assert.equal(runtime.executionRequested, true);
    assert.equal(runtime.readiness.ready, false);
    assert.equal(runtime.mode, RUNTIME_MODES.READ_ONLY);
    assert.equal(runtime.executionEnabled, false);
    assert.equal(runtime.executionStore, null);
    assert.ok(runtime.readiness.blockers.some(item => item.includes('TABLE_MISSING:growthos_records')));
  } finally { await temp.cleanup(); }
});

test('execution store is exposed only when explicitly requested and readiness is fully clean', async () => {
  const temp = await tempMigrations();
  try {
    const migrations = await discoverRuntimeMigrations({ directory: temp.directory });
    const runtime = await bootstrapTenantRuntime({
      pool: poolFor(migrations),
      tenantId: 'tenant-1',
      executionRequested: true,
      migrationDirectory: temp.directory
    });
    assert.equal(runtime.mode, RUNTIME_MODES.EXECUTION_ENABLED);
    assert.equal(runtime.executionEnabled, true);
    const store = assertExecutionRuntime(runtime);
    assert.equal(typeof store.mutateRecordAndAppendEvent, 'function');
  } finally { await temp.cleanup(); }
});

test('executionRequested must be an explicit boolean', async () => {
  await assert.rejects(
    () => bootstrapTenantRuntime({ pool: {}, tenantId: 'tenant-1', executionRequested: 'yes' }),
    /executionRequested must be boolean/
  );
});
