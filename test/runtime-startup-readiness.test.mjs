import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AtomicInMemoryRuntimeStore } from '../src/runtime/atomic-store.mjs';
import { discoverRuntimeMigrations } from '../src/runtime/migrations.mjs';
import {
  evaluateStartupReadiness,
  inspectTenantStartupReadiness,
  assertTenantStartupReady
} from '../src/runtime/startup-readiness.mjs';

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
  const directory = await mkdtemp(path.join(os.tmpdir(), 'growthos-startup-'));
  await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;\n');
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function certifiedPool(migrations) {
  const client = {
    async query(text) {
      if (text.includes('current_database()')) return { rows: [{ database_name: 'growthos_test', schema_name: 'public', server_version: '16-test' }] };
      if (text.includes('FROM information_schema.tables')) return { rows: TABLES.map(table_name => ({ table_name })) };
      if (text.includes('SELECT migration_name, checksum, applied_at')) return { rows: migrations.map(item => ({ migration_name: item.name, checksum: item.checksum, applied_at: '2026-08-19T02:00:00Z' })) };
      if (text.includes('FROM information_schema.columns')) return { rows: Object.entries(COLUMNS).flatMap(([table_name, cols]) => cols.map(column_name => ({ table_name, column_name }))) };
      if (text.includes('FROM pg_indexes')) return { rows: INDEXES.map(indexname => ({ indexname })) };
      if (text.includes("to_regclass('pg_temp.growthos_transaction_probe')")) return { rows: [{ regclass: null }] };
      return { rows: [] };
    },
    release() {}
  };
  return { connect: async () => client };
}

test('pure startup evaluator requires both database and recovery readiness', () => {
  const clean = evaluateStartupReadiness({
    databaseReport: { ready: true, issues: [] },
    recoveryReport: { safeForUnattendedRecovery: true, findings: [], coverage: { potentiallyTruncatedRecordTypes: [] } }
  });
  assert.equal(clean.ready, true);
  assert.deepEqual(clean.blockers, []);

  const blocked = evaluateStartupReadiness({
    databaseReport: { ready: false, issues: ['TABLE_MISSING:growthos_records'] },
    recoveryReport: { safeForUnattendedRecovery: false, findings: [{ code: 'ATTEMPT_RECONCILIATION_REQUIRED' }], coverage: { potentiallyTruncatedRecordTypes: [] } }
  });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.blockers.includes('DATABASE_NOT_READY'));
  assert.ok(blocked.blockers.includes('RECOVERY:ATTEMPT_RECONCILIATION_REQUIRED'));
});

test('clean certified database plus terminal runtime state is startup-ready', async () => {
  const temp = await tempMigrations();
  try {
    const migrations = await discoverRuntimeMigrations({ directory: temp.directory });
    const store = new AtomicInMemoryRuntimeStore();
    await store.putRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: 'attempt-1', payload: { state: 'COMPLETED', actionId: 'action-1' }, expectedRevision: 0 });
    const report = await inspectTenantStartupReadiness({
      pool: certifiedPool(migrations),
      store,
      tenantId: 'tenant-1',
      migrationDirectory: temp.directory,
      now: new Date('2026-08-19T02:30:00Z')
    });
    assert.equal(report.ready, true);
    assert.equal(report.databaseReady, true);
    assert.equal(report.recoveryReady, true);
  } finally { await temp.cleanup(); }
});

test('unresolved attempt blocks startup even when database is certified', async () => {
  const temp = await tempMigrations();
  try {
    const migrations = await discoverRuntimeMigrations({ directory: temp.directory });
    const store = new AtomicInMemoryRuntimeStore();
    await store.putRecord({ tenantId: 'tenant-1', recordType: 'execution_attempt', recordId: 'attempt-1', payload: { state: 'RECONCILIATION_REQUIRED', actionId: 'action-1' }, expectedRevision: 0 });
    const report = await inspectTenantStartupReadiness({
      pool: certifiedPool(migrations), store, tenantId: 'tenant-1', migrationDirectory: temp.directory,
      now: new Date('2026-08-19T02:30:00Z')
    });
    assert.equal(report.ready, false);
    assert.ok(report.blockers.includes('RUNTIME_RECOVERY_NOT_CLEAN'));
    assert.ok(report.blockers.includes('RECOVERY:ATTEMPT_RECONCILIATION_REQUIRED'));
  } finally { await temp.cleanup(); }
});

test('inspection failure itself blocks startup and assertion helper retains report', async () => {
  const temp = await tempMigrations();
  try {
    const store = new AtomicInMemoryRuntimeStore();
    const brokenPool = { connect: async () => { throw new Error('database unavailable'); } };
    const report = await inspectTenantStartupReadiness({ pool: brokenPool, store, tenantId: 'tenant-1', migrationDirectory: temp.directory });
    assert.equal(report.ready, false);
    assert.ok(report.blockers.some(item => item.startsWith('DATABASE_INSPECTION_FAILED:')));

    let caught = null;
    try { await assertTenantStartupReady({ pool: brokenPool, store, tenantId: 'tenant-1', migrationDirectory: temp.directory }); } catch (error) { caught = error; }
    assert.match(caught?.message || '', /GROWTHOS_STARTUP_NOT_READY/);
    assert.equal(caught?.report?.ready, false);
  } finally { await temp.cleanup(); }
});
