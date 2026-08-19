import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const MIGRATION_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 'growthos:migrations:v1';

function requiredFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function.`);
  return value;
}

function checksum(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function assertTransactionNeutralSql(content, name) {
  const transactionControl = /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;?\s*$/gim;
  if (transactionControl.test(content)) {
    throw new Error(`MIGRATION_TRANSACTION_CONTROL_FORBIDDEN:${name}`);
  }
}

export function defaultMigrationDirectory() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');
}

export async function discoverRuntimeMigrations({ directory = defaultMigrationDirectory() } = {}) {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.sql'))
    .map(entry => entry.name)
    .sort();

  for (const name of names) {
    if (!MIGRATION_PATTERN.test(name)) throw new Error(`INVALID_MIGRATION_FILENAME:${name}`);
  }

  const seenOrdinals = new Set();
  const migrations = [];
  for (const name of names) {
    const ordinal = name.slice(0, 3);
    if (seenOrdinals.has(ordinal)) throw new Error(`DUPLICATE_MIGRATION_ORDINAL:${ordinal}`);
    seenOrdinals.add(ordinal);
    const sql = await readFile(path.join(directory, name), 'utf8');
    if (!sql.trim()) throw new Error(`EMPTY_MIGRATION:${name}`);
    assertTransactionNeutralSql(sql, name);
    migrations.push({ name, ordinal, sql, checksum: checksum(sql) });
  }
  return migrations;
}

async function ensureMigrationLedger(query) {
  await query(`CREATE TABLE IF NOT EXISTS growthos_schema_migrations (
    migration_name TEXT PRIMARY KEY,
    checksum CHAR(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

async function appliedMigrations(query) {
  const result = await query(
    `SELECT migration_name, checksum, applied_at
       FROM growthos_schema_migrations
      ORDER BY migration_name ASC`
  );
  return new Map((result.rows || []).map(row => [row.migration_name, row]));
}

export async function runRuntimeMigrations({ pool, directory = defaultMigrationDirectory(), now = new Date() }) {
  if (!pool || typeof pool !== 'object') throw new Error('pool is required.');
  requiredFunction(pool.connect, 'pool.connect');
  const current = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(current.getTime())) throw new Error('now must be a valid date/time.');
  const migrations = await discoverRuntimeMigrations({ directory });
  const client = await pool.connect();
  if (!client || typeof client !== 'object') throw new Error('MIGRATION_CLIENT_UNAVAILABLE');
  const query = requiredFunction(client.query, 'migration client.query').bind(client);
  const release = requiredFunction(client.release, 'migration client.release').bind(client);

  let locked = false;
  let primaryError = null;
  try {
    await query('SELECT pg_advisory_lock(hashtext($1))', [LOCK_KEY]);
    locked = true;
    await ensureMigrationLedger(query);
    const applied = await appliedMigrations(query);
    const results = [];

    for (const migration of migrations) {
      const existing = applied.get(migration.name);
      if (existing) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${migration.name}`);
        }
        results.push({ name: migration.name, status: 'ALREADY_APPLIED', checksum: migration.checksum });
        continue;
      }

      try {
        await query('BEGIN');
        await query(migration.sql);
        await query(
          `INSERT INTO growthos_schema_migrations (migration_name, checksum, applied_at)
           VALUES ($1, $2, $3::timestamptz)`,
          [migration.name, migration.checksum, current.toISOString()]
        );
        await query('COMMIT');
        results.push({ name: migration.name, status: 'APPLIED', checksum: migration.checksum });
      } catch (error) {
        try {
          await query('ROLLBACK');
        } catch (rollbackError) {
          const wrapped = new Error(`MIGRATION_ROLLBACK_FAILED:${migration.name}`);
          wrapped.cause = error;
          wrapped.rollbackCause = rollbackError;
          throw wrapped;
        }
        throw error;
      }
    }

    return { migrations: results, appliedCount: results.filter(item => item.status === 'APPLIED').length };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (locked) {
      try {
        await query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
      } catch (unlockError) {
        if (!primaryError) throw unlockError;
      }
    }
    release();
  }
}
