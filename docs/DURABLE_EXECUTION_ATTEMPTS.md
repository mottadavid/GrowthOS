# Durable Execution Attempts

Execution attempts are the highest-risk runtime state in GrowthOS because losing or partially recovering them can duplicate external side effects after a restart.

Examples include:

- SMS/email/WhatsApp sends;
- social publishing;
- ad-platform mutations;
- Google Business Profile changes;
- future external growth actions.

## Core rule

> GrowthOS must be able to prove the complete attempt history for the exact action before another attempt is created.

A process restart, worker failover, network timeout, or runtime crash must never reset that history.

## Record identity

Durable execution attempts are stored as:

```text
recordType = execution_attempt
recordId   = attemptId
indexKey   = actionId
```

`indexKey` is an immutable secondary recovery key scoped by:

```text
tenantId + recordType + indexKey
```

It is not globally unique and must never be queried without tenant and record type.

## Why the index is required

A tenant may eventually have many thousands of execution-attempt records. A bounded tenant-wide recovery scan followed by in-memory filtering could miss an older attempt for the same action and incorrectly conclude that another attempt is permitted.

The exact action history therefore uses the storage-level secondary index, not a partial tenant scan.

Migration `002_runtime_record_index_key.sql` adds the nullable `index_key` column and its tenant/type/index recovery index.

## Attempt creation

`createDurableExecutionAttempt()`:

1. reads attempt history for the exact tenant + action;
2. validates every recovered attempt identity;
3. applies the core unresolved-attempt and attempt-ceiling rules;
4. creates the new attempt only when allowed;
5. atomically persists the attempt record and creation event.

An unresolved prior attempt continues to block a new attempt after process restart.

## Transitions

Every durable transition:

1. loads the current record by tenant + attempt ID;
2. validates `indexKey === payload.actionId`;
3. applies the existing pure execution-attempt state machine;
4. preserves attempt ID, action ID, and action hash;
5. uses record revision compare-and-swap;
6. atomically persists the new state and a deterministic transition event.

Supported durable transitions mirror the core state machine:

- submitting;
- accepted;
- completed;
- definitive failure;
- definitively not accepted;
- reconciliation required;
- reconciled outcome.

## Deterministic event identity

Transition events use:

```text
execution-attempt:<attemptId>:revision:<revision>:<state>
```

This makes the evidence replay-safe if the caller loses the response after a successful commit.

## Privacy

The durable attempt record may contain operational result/error metadata needed for reconciliation. Transition events intentionally retain only a compact evidence projection:

- attempt ID;
- action ID/hash;
- attempt number;
- state;
- external execution ID when present;
- reconciliation outcome when present.

Normal telemetry should prefer those evidence events rather than dumping full runtime records.

## Fail-closed recovery

Recovery refuses attempts when:

- stored payload hash is invalid;
- tenant identity differs;
- record ID differs from payload attempt ID;
- secondary `indexKey` differs from payload action ID;
- action hash/identity changes during a transition;
- the prior attempt remains unresolved;
- the attempt ceiling has been reached.

## Remaining production proof

This repository layer is not by itself proof of real database durability. Before unattended client execution, the broader runtime release gates still apply:

1. real PostgreSQL transaction integration;
2. migration execution against the chosen GrowthOS database;
3. restart/recovery drill;
4. forced ambiguous-outcome reconciliation drill;
5. backup/restore proof;
6. monitoring for DB/transaction failures.
