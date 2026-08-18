# Atomic Runtime Mutations

GrowthOS runtime state is authoritative only when the state transition and its durable evidence are committed together.

## Core rule

> An authoritative state transition must not commit unless its corresponding durable event commits in the same transaction.

The inverse also applies: an event must not claim a transition happened if the state compare-and-swap did not commit.

This matters for:

- action-envelope activation/revocation/replacement;
- campaign lifecycle transitions;
- experiment lifecycle transitions;
- execution attempts and reconciliation;
- Growth Run manifests;
- other future autonomous-growth state with operational consequences.

## Why independent writes are insufficient

A sequence such as:

```text
putRecord(COMPLETED)
process crashes
appendEvent(COMPLETED)
```

can permanently leave state and evidence disagreeing.

Reversing the order is not safer:

```text
appendEvent(COMPLETED)
process crashes
putRecord(COMPLETED)
```

can leave an event claiming an outcome that the authoritative state never accepted.

## Runtime API

Authoritative transitions use:

```text
mutateAuthoritativeRuntimeState(...)
```

The supplied store must implement:

```text
mutateRecordAndAppendEvent(...)
```

Otherwise the mutation fails with `RUNTIME_ATOMIC_MUTATION_REQUIRED`.

## PostgreSQL contract

`AtomicPostgresRuntimeStore` requires a caller-supplied:

```text
withTransaction(callback)
```

The callback receives the query function bound to one database transaction. Both the record compare-and-swap and event insert execute through that same transaction query.

GrowthOS intentionally does not implement `BEGIN` / `COMMIT` against a global database client itself because the database-driver/runtime ownership has not yet been chosen. The eventual runtime adapter must prove that `withTransaction` really commits or rolls back as one database transaction.

## In-memory contract

`AtomicInMemoryRuntimeStore` snapshots its record/event maps before the mutation and restores both when either operation fails. This exists for deterministic contract testing and local simulation; it is not a production durability substitute.

## Existing lower-level primitives

`putRecord()` and `appendEvent()` remain available as lower-level store operations. They are appropriate for controlled migration/import/recovery tooling and tests.

They are not sufficient by themselves for authoritative lifecycle transitions.

## Concurrency

The record half of the transaction retains the existing `expectedRevision` compare-and-swap contract. Therefore a concurrent writer cannot silently overwrite a state transition. If the state CAS fails, the event insert must roll back with it.

## Idempotency

The event half retains exact event-ID idempotency:

- same event ID + exact same content = idempotent replay;
- same event ID + different content = `RUNTIME_EVENT_ID_CONFLICT`;
- event conflict rolls back the associated state transition.

## Tenant isolation

The record tenant is authoritative for the transaction. A caller-supplied event tenant that differs from the record tenant is rejected before writes with `RUNTIME_MUTATION_EVENT_TENANT_MISMATCH`.

## Remaining production proof

This doctrine and adapter semantics do not themselves prove production database atomicity. Before client execution, GrowthOS still requires:

1. a real PostgreSQL transaction wrapper;
2. integration tests against PostgreSQL;
3. a forced-failure test proving rollback after the record write and before event completion;
4. restart/recovery drill;
5. migration and backup/restore proof;
6. operational monitoring for transaction/database failures.

Until those are proven, runtime persistence is structurally ready but not certified for unattended client execution.
