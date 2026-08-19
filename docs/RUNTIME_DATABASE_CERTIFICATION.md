# Runtime Database Certification

GrowthOS must not treat a reachable PostgreSQL endpoint as a certified runtime database.

`inspectRuntimeDatabase()` and `assertRuntimeDatabaseReady()` provide a deployment-time certification gate for the current GrowthOS runtime schema.

## Evidence checked

The probe verifies:

- database identity and PostgreSQL server version metadata
- exact migration files expected by this GrowthOS build
- exact migration ledger checksums
- no unknown applied migration relative to the running build
- required runtime tables
- required columns
- required indexes
- transaction rollback behavior using a temporary table created inside a transaction and rolled back

## Required tables

- `growthos_records`
- `growthos_events`
- `growthos_schema_migrations`

## Failure semantics

The report is `ready: false` when any required migration, table, column, index, checksum, or rollback proof is missing.

An uninitialized database is reported as not ready. It is not treated as an exceptional success-path condition and the inspector does not attempt to migrate it automatically.

`assertRuntimeDatabaseReady()` throws `GROWTHOS_DATABASE_NOT_READY:<issues>` and attaches the full report.

## Rollback probe

The probe acquires one connection and executes:

1. `BEGIN`
2. create a temporary `growthos_transaction_probe` table
3. insert one temporary row
4. `ROLLBACK`
5. verify the temporary table does not exist

It does not write tenant/customer data or permanent GrowthOS state.

## Why unknown applied migrations fail

A database whose migration ledger is ahead of the running application may contain schema semantics the current binary does not understand. Certification therefore fails closed instead of assuming backward compatibility.

## Deployment sequence

1. provision the GrowthOS database/user
2. configure `GROWTHOS_DATABASE_URL`
3. construct the actual PostgreSQL pool
4. run `runRuntimeMigrations()`
5. run `assertRuntimeDatabaseReady()`
6. only then enable authoritative runtime state
7. perform restart/recovery and backup/restore drills separately

## Still external proof

Repository tests exercise the evaluator and a fake PostgreSQL query surface. Production readiness still requires evidence from the real deployed database, including the actual migration run, rollback probe, restart recovery, and backup restoration.
