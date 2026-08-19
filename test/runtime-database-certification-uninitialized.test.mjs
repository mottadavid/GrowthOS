import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectRuntimeDatabase } from '../src/runtime/database-certification.mjs';

async function tempMigrations() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'growthos-cert-empty-'));
  await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;\n');
  return { directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('uninitialized database returns explicit not-ready evidence instead of crashing on missing migration ledger', async () => {
  const temp = await tempMigrations();
  let releases = 0;
  const client = {
    async query(text) {
      if (text.includes('current_database()')) return { rows: [{ database_name: 'empty_growthos', schema_name: 'public', server_version: '16-test' }] };
      if (text.includes('FROM information_schema.tables')) return { rows: [] };
      if (text.includes('FROM information_schema.columns')) return { rows: [] };
      if (text.includes('FROM pg_indexes')) return { rows: [] };
      if (text.includes("to_regclass('pg_temp.growthos_transaction_probe')")) return { rows: [{ regclass: null }] };
      if (text.includes('FROM growthos_schema_migrations')) throw new Error('should not query missing ledger');
      return { rows: [] };
    },
    release() { releases += 1; }
  };
  try {
    const report = await inspectRuntimeDatabase({ pool: { connect: async () => client }, directory: temp.directory });
    assert.equal(report.ready, false);
    assert.ok(report.issues.includes('TABLE_MISSING:growthos_schema_migrations'));
    assert.ok(report.issues.includes('MIGRATION_MISSING:001_first.sql'));
    assert.equal(releases, 1);
  } finally { await temp.cleanup(); }
});
