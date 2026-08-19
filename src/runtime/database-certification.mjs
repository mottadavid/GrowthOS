import { discoverRuntimeMigrations, defaultMigrationDirectory } from './migrations.mjs';

const REQUIRED_TABLES = Object.freeze([
  'growthos_records',
  'growthos_events',
  'growthos_schema_migrations'
]);

const REQUIRED_COLUMNS = Object.freeze({
  growthos_records: ['tenant_id','record_type','record_id','index_key','revision','payload','payload_hash','created_at','updated_at'],
  growthos_events: ['event_id','tenant_id','event_type','occurred_at','recorded_at','correlation_id','causation_id','payload','payload_hash'],
  growthos_schema_migrations: ['migration_name','checksum','applied_at']
});

const REQUIRED_INDEXES = Object.freeze([
  'growthos_records_pkey',
  'growthos_records_tenant_type_updated_idx',
  'growthos_records_tenant_type_index_key_idx',
  'growthos_events_pkey',
  'growthos_events_tenant_recorded_idx',
  'growthos_events_tenant_correlation_recorded_idx',
  'growthos_schema_migrations_pkey'
]);

function requiredFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function.`);
  return value;
}

export function evaluateRuntimeDatabaseEvidence({ migrations, appliedMigrations, tables, columns, indexes, rollbackVerified }) {
  const issues = [];
  const expectedByName = new Map(migrations.map(item => [item.name, item.checksum]));
  const appliedByName = new Map(appliedMigrations.map(item => [item.migration_name, item.checksum]));

  for (const migration of migrations) {
    if (!appliedByName.has(migration.name)) issues.push(`MIGRATION_MISSING:${migration.name}`);
    else if (appliedByName.get(migration.name) !== migration.checksum) issues.push(`MIGRATION_CHECKSUM_MISMATCH:${migration.name}`);
  }
  for (const applied of appliedMigrations) {
    if (!expectedByName.has(applied.migration_name)) issues.push(`UNKNOWN_APPLIED_MIGRATION:${applied.migration_name}`);
  }

  const tableSet = new Set(tables);
  for (const table of REQUIRED_TABLES) if (!tableSet.has(table)) issues.push(`TABLE_MISSING:${table}`);

  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const actual = new Set(columns[table] || []);
    for (const column of required) if (!actual.has(column)) issues.push(`COLUMN_MISSING:${table}.${column}`);
  }

  const indexSet = new Set(indexes);
  for (const index of REQUIRED_INDEXES) if (!indexSet.has(index)) issues.push(`INDEX_MISSING:${index}`);
  if (rollbackVerified !== true) issues.push('ROLLBACK_PROBE_NOT_VERIFIED');

  return {
    ready: issues.length === 0,
    issues,
    summary: {
      expectedMigrationCount: migrations.length,
      appliedMigrationCount: appliedMigrations.length,
      requiredTableCount: REQUIRED_TABLES.length,
      requiredIndexCount: REQUIRED_INDEXES.length,
      rollbackVerified: rollbackVerified === true
    }
  };
}

async function collectEvidence({ client, directory }) {
  const migrations = await discoverRuntimeMigrations({ directory });
  const applied = await client.query(
    `SELECT migration_name, checksum, applied_at
       FROM growthos_schema_migrations
      ORDER BY migration_name ASC`
  );
  const tableRows = await client.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])`,
    [REQUIRED_TABLES]
  );
  const columnRows = await client.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ANY($1::text[])
      ORDER BY table_name, ordinal_position`,
    [REQUIRED_TABLES]
  );
  const indexRows = await client.query(
    `SELECT indexname
       FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = ANY($1::text[])`,
    [REQUIRED_TABLES]
  );

  let rollbackVerified = false;
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE growthos_transaction_probe(value integer) ON COMMIT DROP');
    await client.query('INSERT INTO growthos_transaction_probe(value) VALUES (1)');
    await client.query('ROLLBACK');
    const probe = await client.query("SELECT to_regclass('pg_temp.growthos_transaction_probe') AS regclass");
    rollbackVerified = (probe.rows?.[0]?.regclass ?? null) === null;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    rollbackVerified = false;
  }

  const columns = {};
  for (const row of columnRows.rows || []) {
    if (!columns[row.table_name]) columns[row.table_name] = [];
    columns[row.table_name].push(row.column_name);
  }

  return {
    migrations,
    appliedMigrations: applied.rows || [],
    tables: (tableRows.rows || []).map(row => row.table_name),
    columns,
    indexes: (indexRows.rows || []).map(row => row.indexname),
    rollbackVerified
  };
}

export async function inspectRuntimeDatabase({ pool, directory = defaultMigrationDirectory() }) {
  if (!pool || typeof pool !== 'object') throw new Error('pool is required.');
  requiredFunction(pool.connect, 'pool.connect');
  const client = await pool.connect();
  if (!client || typeof client !== 'object') throw new Error('DATABASE_CERTIFICATION_CLIENT_UNAVAILABLE');
  requiredFunction(client.query, 'database certification client.query');
  requiredFunction(client.release, 'database certification client.release');

  try {
    const identityResult = await client.query(
      `SELECT current_database() AS database_name,
              current_schema() AS schema_name,
              current_setting('server_version') AS server_version`
    );
    const evidence = await collectEvidence({ client, directory });
    const evaluation = evaluateRuntimeDatabaseEvidence(evidence);
    return {
      schemaVersion: 1,
      database: {
        name: identityResult.rows?.[0]?.database_name ?? null,
        schema: identityResult.rows?.[0]?.schema_name ?? null,
        serverVersion: identityResult.rows?.[0]?.server_version ?? null
      },
      ...evaluation
    };
  } finally {
    client.release();
  }
}

export async function assertRuntimeDatabaseReady(input) {
  const report = await inspectRuntimeDatabase(input);
  if (!report.ready) {
    const error = new Error(`GROWTHOS_DATABASE_NOT_READY:${report.issues.join(',')}`);
    error.report = report;
    throw error;
  }
  return report;
}
