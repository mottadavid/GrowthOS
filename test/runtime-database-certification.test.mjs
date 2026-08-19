import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  evaluateRuntimeDatabaseEvidence,
  inspectRuntimeDatabase,
  assertRuntimeDatabaseReady
} from '../src/runtime/database-certification.mjs';
import { discoverRuntimeMigrations } from '../src/runtime/migrations.mjs';

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
  const directory = await mkdtemp(path.join(os.tmpdir(), 'growthos-cert-'));
  await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;\n');
  await writeFile(path.join(directory, '002_second.sql'), 'SELECT 2;\n');
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function evidence(migrations, overrides = {}) {
  return {
    migrations,
    appliedMigrations: migrations.map(item => ({ migration_name: item.name, checksum: item.checksum })),
    tables: [...TABLES],
    columns: structuredClone(COLUMNS),
    indexes: [...INDEXES],
    rollbackVerified: true,
    ...overrides
  };
}

test('pure evaluator certifies exact migration/schema/rollback evidence', async () => {
  const temp = await tempMigrations();
  try {
    const migrations = await discoverRuntimeMigrations({ directory: temp.directory });
    const report = evaluateRuntimeDatabaseEvidence(evidence(migrations));
    assert.equal(report.ready, true);
    assert.deepEqual(report.issues, []);
    assert.equal(report.summary.rollbackVerified, true);
  } finally { await temp.cleanup(); }
});

test('pure evaluator fails closed on missing or drifted migrations and unknown applied migration', async () => {
  const temp = await tempMigrations();
  try {
    const migrations = await discoverRuntimeMigrations({ directory: temp.directory });
    const report = evaluateRuntimeDatabaseEvidence(evidence(migrations, {
      appliedMigrations: [
        { migration_name: migrations[0].name, checksum: 'a'.repeat(64) },
        { migration_name: '999_unknown.sql', checksum: 'b'.repeat(64) }
      ]
    }));
    assert.equal(report.ready, false);
    assert.ok(report.issues.includes(`MIGRATION_CHECKSUM_MISMATCH:${migrations[0].name}`));
    assert.ok(report.issues.includes(`MIGRATION_MISSING:${migrations[1].name}`));
    assert.ok(report.issues.includes('UNKNOWN_APPLIED_MIGRATION:999_unknown.sql'));
  } finally { await temp.cleanup(); }
});

test('pure evaluator reports missing table column index and rollback proof independently', async () => {
  const temp = await tempMigrations();
  try {
    const migrations = await discoverRuntimeMigrations({ directory: temp.directory });
    const badColumns = structuredClone(COLUMNS);
    badColumns.growthos_records = badColumns.growthos_records.filter(item => item !== 'index_key');
    const report = evaluateRuntimeDatabaseEvidence(evidence(migrations, {
      tables: TABLES.filter(item => item !== 'growthos_events'),
      columns: badColumns,
      indexes: INDEXES.filter(item => item !== 'growthos_events_tenant_recorded_idx'),
      rollbackVerified: false
    }));
    assert.equal(report.ready, false);
    assert.ok(report.issues.includes('TABLE_MISSING:growthos_events'));
    assert.ok(report.issues.includes('COLUMN_MISSING:growthos_records.index_key'));
    assert.ok(report.issues.includes('INDEX_MISSING:growthos_events_tenant_recorded_idx'));
    assert.ok(report.issues.includes('ROLLBACK_PROBE_NOT_VERIFIED'));
  } finally { await temp.cleanup(); }
});

function fakeCertifiedPool({ migrations, rollbackVisible = false }) {
  let releases = 0;
  const calls = [];
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes('current_database()')) return { rows: [{ database_name: 'growthos_test', schema_name: 'public', server_version: '16-test' }] };
      if (text.includes('SELECT migration_name, checksum, applied_at')) return { rows: migrations.map(item => ({ migration_name: item.name, checksum: item.checksum, applied_at: '2026-08-19T02:00:00Z' })) };
      if (text.includes('FROM information_schema.tables')) return { rows: TABLES.map(table_name => ({ table_name })) };
      if (text.includes('FROM information_schema.columns')) return { rows: Object.entries(COLUMNS).flatMap(([table_name, cols]) => cols.map(column_name => ({ table_name, column_name }))) };
      if (text.includes('FROM pg_indexes')) return { rows: INDEXES.map(indexname => ({ indexname })) };
      if (text.includes("to_regclass('pg_temp.growthos_transaction_probe')")) return { rows: [{ regclass: rollbackVisible ? 'growthos_transaction_probe' : null }] };
      return { rows: [] };
    },
    release() { releases += 1; }
  };
  return {
    pool: { async connect() { return client; } },
    calls,
    get releases() { return releases; }
  };
}

test('database-facing inspection verifies identity, schema, migrations, rollback and releases client', async () => {
  const temp = await tempMigrations();
  try {
    const migrations = await discoverRuntimeMigrations({ directory: temp.directory });
    const fake = fakeCertifiedPool({ migrations });
    const report = await inspectRuntimeDatabase({ pool: fake.pool, directory: temp.directory });
    assert.equal(report.ready, true);
    assert.deepEqual(report.database, { name: 'growthos_test', schema: 'public', serverVersion: '16-test' });
    assert.equal(fake.releases, 1);
    assert.ok(fake.calls.some(call => call.text === 'BEGIN'));
    assert.ok(fake.calls.some(call => call.text === 'ROLLBACK'));
    assert.ok(fake.calls.some(call => call.text.includes('CREATE TEMP TABLE growthos_transaction_probe')));
  } finally { await temp.cleanup(); }
});

test('failed rollback proof makes inspection not ready and assert helper throws with report', async () => {
  const temp = await tempMigrations();
  try {
    const migrations = await discoverRuntimeMigrations({ directory: temp.directory });
    const fake = fakeCertifiedPool({ migrations, rollbackVisible: true });
    const report = await inspectRuntimeDatabase({ pool: fake.pool, directory: temp.directory });
    assert.equal(report.ready, false);
    assert.ok(report.issues.includes('ROLLBACK_PROBE_NOT_VERIFIED'));

    const fake2 = fakeCertifiedPool({ migrations, rollbackVisible: true });
    let caught = null;
    try { await assertRuntimeDatabaseReady({ pool: fake2.pool, directory: temp.directory }); } catch (error) { caught = error; }
    assert.match(caught?.message || '', /GROWTHOS_DATABASE_NOT_READY/);
    assert.equal(caught?.report?.ready, false);
  } finally { await temp.cleanup(); }
});
