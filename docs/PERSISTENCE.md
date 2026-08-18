# GrowthOS Runtime Persistence

## Decision

GrowthOS runtime continuity must not live only in process memory.

The first durable store uses PostgreSQL semantics behind a dedicated application configuration:

```text
GROWTHOS_DATABASE_URL
```

GrowthOS does **not** fall back to Wiserr's `DATABASE_URL`.

The deployment target may later be:

1. a dedicated database + least-privilege user on an existing managed PostgreSQL cluster, if capacity/isolation/backup are verified; or
2. a dedicated GrowthOS managed PostgreSQL cluster.

That infrastructure choice must not change application semantics.

## Why PostgreSQL

The first live loop already needs durable state for:

- action envelopes;
- campaign lifecycle;
- experiments;
- execution attempts and reconciliation;
- policy receipts;
- Growth Run Manifests;
- upstream authority receipts;
- growth events/outcomes.

These records require atomic compare-and-swap writes, indexed tenant-scoped discovery, append-only events, and crash recovery. PostgreSQL is already an operationally understood technology in the broader Wiserr environment, but GrowthOS remains database-isolated by configuration.

## V1 storage model

V1 deliberately uses two generic durable authorities rather than prematurely creating one table per domain.

### `growthos_records`

Versioned runtime state:

```text
tenant_id
record_type
record_id
revision
payload JSONB
payload_hash
created_at
updated_at
```

Primary key:

```text
(tenant_id, record_type, record_id)
```

Writes require `expectedRevision`.

- `expectedRevision = 0` means create-only.
- `expectedRevision = N` means update only if the current revision is exactly N.
- successful update becomes revision N+1.
- mismatch returns `RUNTIME_RECORD_REVISION_CONFLICT`.

There is no blind upsert.

This prevents two workers or agents from silently overwriting each other's state.

### `growthos_events`

Append-only runtime/event evidence:

```text
event_id
 tenant_id
 event_type
 occurred_at
 recorded_at
 correlation_id
 causation_id
 payload JSONB
 payload_hash
```

`event_id` is immutable identity.

Re-appending the exact same event is idempotent. Reusing an existing event ID with different content is `RUNTIME_EVENT_ID_CONFLICT`.

## Hash integrity

Every stored payload carries SHA-256 over canonical JSON.

GrowthOS recomputes the hash on reads and recovery listings.

A database row whose payload does not match its stored hash fails with:

```text
RUNTIME_RECORD_HASH_MISMATCH
RUNTIME_EVENT_HASH_MISMATCH
```

This is corruption/tamper detection, not cryptographic secrecy.

## Tenant isolation

Every state read/write key includes `tenantId`.

Recovery discovery requires both:

```text
tenantId + recordType
```

There is intentionally no generic runtime-store method for listing all tenants' records.

A higher-level scheduler that needs cross-tenant work must obtain the authorized tenant set from the canonical tenant authority rather than using the GrowthOS database as a tenant directory.

Events likewise require tenant-scoped reads, optionally narrowed by correlation ID.

## Private data

The runtime database may contain operationally private GrowthOS state. Some records—especially execution commands—can include approved message content.

Therefore:

- never log record/event payloads by default;
- normal telemetry should use IDs, hashes, types, revisions, and state labels;
- database credentials are secrets;
- least-privilege database users are required;
- tenant-scoped application access remains mandatory even if database credentials technically permit broader reads.

## No deletion API in V1

The V1 runtime store intentionally exposes no generic delete method.

Domain retention/deletion requirements need explicit policy because deletion can destroy:

- reconciliation evidence;
- approval lineage;
- audit evidence;
- outcome attribution history.

Retention, legal deletion, and archival will be designed as governed workflows rather than a convenience method on the core store.

## Recovery

After restart, a worker may use tenant-scoped `listRecords()` to discover relevant record types, then each domain validator decides which states need continuation or reconciliation.

The store does not autonomously resume work. It only supplies verified durable state.

Unknown provider/execution outcomes still remain `RECONCILIATION_REQUIRED`; persistence does not convert uncertainty into failure or permission to retry.

## Migration

`migrations/001_runtime_store.sql` creates the two V1 tables and indexes.

This repository does not yet contain a production migration runner or PostgreSQL driver. The Postgres adapter receives an injected `query(text, values)` function so storage semantics remain testable without coupling the control plane to a specific driver.

Before production use, we still require:

1. provision/choose the actual GrowthOS database and least-privilege user;
2. confirm database/cluster capacity and isolation;
3. apply migration in a controlled environment;
4. run real PostgreSQL integration tests;
5. prove restart/recovery behavior;
6. prove backup restoration for GrowthOS state;
7. define deployment secret handling for `GROWTHOS_DATABASE_URL`.

## Existing Wiserr infrastructure is not assumed safe by default

Wiserr currently documents DigitalOcean Managed PostgreSQL with automated backups/PITR, but backup restore verification is a known operational gap. GrowthOS must not infer that sharing the current database/cluster is safe merely because PostgreSQL already exists.

Reuse is an ops decision backed by measured headroom, tenant/security isolation, least privilege, and restore evidence.
