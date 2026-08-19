# Runtime Migrations

GrowthOS runtime schema changes are ordered SQL migrations under `migrations/`.

## Naming

Migration filenames must match:

`NNN_lowercase_name.sql`

Rules:

- three-digit unique ordinal
- lowercase letters, digits, underscores
- `.sql` suffix
- no duplicate ordinals
- non-empty file
- migration SQL must not contain its own `BEGIN`, `COMMIT`, or `ROLLBACK`

The runner owns the transaction boundary.

## Runner

`runRuntimeMigrations({ pool })`:

1. discovers and checksum-validates migration files
2. acquires a dedicated PostgreSQL client
3. acquires an advisory migration lock
4. creates the `growthos_schema_migrations` ledger if absent
5. reads applied migration names/checksums
6. refuses an applied migration whose file checksum changed
7. executes each unapplied migration inside `BEGIN` / `COMMIT`
8. records the migration checksum in the same transaction as the migration SQL
9. rolls back a failed migration
10. releases the advisory lock and database client

## Immutability

Once a migration is applied to any durable environment, do not edit that file. Add a new migration.

Checksum drift produces `MIGRATION_CHECKSUM_MISMATCH:<name>`.

## Concurrency

The runner holds the PostgreSQL advisory lock keyed by `growthos:migrations:v1` for the migration train. Multiple deployers must not independently race migrations.

## Failure bias

- SQL failure -> rollback migration; do not record ledger row.
- rollback failure -> surface `MIGRATION_ROLLBACK_FAILED:<name>` with original and rollback causes.
- invalid filename/order/transaction control -> refuse before connecting to production mutation flow.
- applied checksum mismatch -> refuse before executing changed SQL.

## Current migrations

- `001_runtime_store.sql`
- `002_runtime_record_index_key.sql`

`001_runtime_store.sql` is transaction-neutral; the migration runner owns its transaction.

## Still unproven

Repository tests do not prove a live database deployment. Before production use, GrowthOS still requires:

- provisioned GrowthOS PostgreSQL database/user
- `GROWTHOS_DATABASE_URL` secret
- real `pg.Pool` construction
- migration execution against that database
- live schema verification
- forced SQL failure/rollback drill
- durable state restart/recovery drill
- backup restoration drill

Do not mark those gates complete until there is runtime evidence.
