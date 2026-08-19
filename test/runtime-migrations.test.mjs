import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  discoverRuntimeMigrations,
  runRuntimeMigrations
} from '../src/runtime/migrations.mjs';

async function tempMigrations(files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'growthos-migrations-'));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(directory, name), content, 'utf8');
  }
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function fakePool({ applied = [], failSqlContaining = null, failRollback = false } = {}) {
  const calls = [];
  let releases = 0;
  const ledger = new Map(applied.map(row => [row.migration_name, { ...row }]));
  const client = {
    async query(text, values = []) {
      calls.push({ text, values });
      if (text.includes('SELECT migration_name, checksum, applied_at')) {
        return { rows: [...ledger.values()].sort((a, b) => a.migration_name.localeCompare(b.migration_name)) };
      }
      if (text.includes('INSERT INTO growthos_schema_migrations')) {
        ledger.set(values[0], { migration_name: values[0], checksum: values[1], applied_at: values[2] });
        return { rows: [] };
      }
      if (text === 'ROLLBACK' && failRollback) throw new Error('rollback failed');
      if (failSqlContaining && text.includes(failSqlContaining)) throw new Error('migration SQL failed');
      return { rows: [] };
    },
    release() { releases += 1; }
  };
  return {
    pool: { async connect() { calls.push({ text: 'CONNECT', values: [] }); return client; } },
    calls,
    ledger,
    get releases() { return releases; }
  };
}

test('discovers migration files in deterministic ordinal order with checksums', async () => {
  const temp = await tempMigrations({
    '002_second.sql': 'SELECT 2;\n',
    '001_first.sql': 'SELECT 1;\n'
  });
  try {
    const migrations = await discoverRuntimeMigrations({ directory: temp.directory });
    assert.deepEqual(migrations.map(item => item.name), ['001_first.sql', '002_second.sql']);
    assert.match(migrations[0].checksum, /^[0-9a-f]{64}$/);
  } finally { await temp.cleanup(); }
});

test('rejects invalid names duplicate ordinals empty files and nested transaction control', async () => {
  for (const files of [
    { 'bad.sql': 'SELECT 1;' },
    { '001_one.sql': 'SELECT 1;', '001_two.sql': 'SELECT 2;' },
    { '001_empty.sql': '   \n' },
    { '001_nested.sql': 'BEGIN;\nSELECT 1;\nCOMMIT;\n' }
  ]) {
    const temp = await tempMigrations(files);
    try {
      await assert.rejects(() => discoverRuntimeMigrations({ directory: temp.directory }), /INVALID_MIGRATION_FILENAME|DUPLICATE_MIGRATION_ORDINAL|EMPTY_MIGRATION|MIGRATION_TRANSACTION_CONTROL_FORBIDDEN/);
    } finally { await temp.cleanup(); }
  }
});

test('applies migrations under one advisory lock and records checksum inside each migration transaction', async () => {
  const temp = await tempMigrations({
    '001_first.sql': 'CREATE TABLE first_table(id int);\n',
    '002_second.sql': 'ALTER TABLE first_table ADD COLUMN name text;\n'
  });
  const fake = fakePool();
  try {
    const result = await runRuntimeMigrations({ pool: fake.pool, directory: temp.directory, now: new Date('2026-08-19T02:20:00Z') });
    assert.equal(result.appliedCount, 2);
    assert.deepEqual(result.migrations.map(item => item.status), ['APPLIED', 'APPLIED']);
    assert.equal(fake.releases, 1);
    const texts = fake.calls.map(call => call.text);
    assert.equal(texts[0], 'CONNECT');
    assert.equal(texts[1], 'SELECT pg_advisory_lock(hashtext($1))');
    assert.equal(texts.filter(text => text === 'BEGIN').length, 2);
    assert.equal(texts.filter(text => text === 'COMMIT').length, 2);
    assert.equal(texts.filter(text => text.includes('INSERT INTO growthos_schema_migrations')).length, 2);
    assert.equal(texts.at(-1), 'SELECT pg_advisory_unlock(hashtext($1))');
  } finally { await temp.cleanup(); }
});

test('already applied migration with same checksum is idempotent and does not rerun SQL', async () => {
  const temp = await tempMigrations({ '001_first.sql': 'SELECT 1;\n' });
  try {
    const discovered = await discoverRuntimeMigrations({ directory: temp.directory });
    const fake = fakePool({ applied: [{ migration_name: '001_first.sql', checksum: discovered[0].checksum, applied_at: '2026-08-19T02:00:00Z' }] });
    const result = await runRuntimeMigrations({ pool: fake.pool, directory: temp.directory });
    assert.equal(result.appliedCount, 0);
    assert.equal(result.migrations[0].status, 'ALREADY_APPLIED');
    assert.equal(fake.calls.some(call => call.text === 'SELECT 1;\n'), false);
  } finally { await temp.cleanup(); }
});

test('checksum drift for an applied migration fails before executing changed SQL', async () => {
  const temp = await tempMigrations({ '001_first.sql': 'SELECT 2;\n' });
  try {
    const fake = fakePool({ applied: [{ migration_name: '001_first.sql', checksum: 'a'.repeat(64), applied_at: '2026-08-19T02:00:00Z' }] });
    await assert.rejects(() => runRuntimeMigrations({ pool: fake.pool, directory: temp.directory }), /MIGRATION_CHECKSUM_MISMATCH:001_first.sql/);
    assert.equal(fake.calls.some(call => call.text === 'SELECT 2;\n'), false);
    assert.equal(fake.releases, 1);
  } finally { await temp.cleanup(); }
});

test('migration SQL failure rolls back and does not write ledger row', async () => {
  const temp = await tempMigrations({ '001_first.sql': 'CREATE TABLE explode(id int);\n' });
  const fake = fakePool({ failSqlContaining: 'CREATE TABLE explode' });
  try {
    await assert.rejects(() => runRuntimeMigrations({ pool: fake.pool, directory: temp.directory }), /migration SQL failed/);
    assert.equal(fake.calls.some(call => call.text === 'ROLLBACK'), true);
    assert.equal(fake.calls.some(call => call.text.includes('INSERT INTO growthos_schema_migrations')), false);
    assert.equal(fake.releases, 1);
  } finally { await temp.cleanup(); }
});

test('rollback failure is surfaced distinctly and the client is still released', async () => {
  const temp = await tempMigrations({ '001_first.sql': 'CREATE TABLE explode(id int);\n' });
  const fake = fakePool({ failSqlContaining: 'CREATE TABLE explode', failRollback: true });
  try {
    let caught = null;
    try { await runRuntimeMigrations({ pool: fake.pool, directory: temp.directory }); } catch (error) { caught = error; }
    assert.match(caught?.message || '', /MIGRATION_ROLLBACK_FAILED:001_first.sql/);
    assert.match(caught?.cause?.message || '', /migration SQL failed/);
    assert.match(caught?.rollbackCause?.message || '', /rollback failed/);
    assert.equal(fake.releases, 1);
  } finally { await temp.cleanup(); }
});
