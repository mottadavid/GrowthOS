# PostgreSQL Transaction Adapter

GrowthOS authoritative runtime mutations require state and audit evidence to commit atomically.

## Contract

`createAtomicPostgresRuntimeStoreFromPool({ pool })` adapts a `pg.Pool`-compatible object into the existing `AtomicPostgresRuntimeStore` contract.

The adapter requires:

- `pool.query(text, values)` for normal reads/writes outside an atomic mutation
- `pool.connect()` for transaction-scoped work
- acquired client `query(text, values)`
- acquired client `release()`

Each authoritative mutation executes as:

1. acquire one client
2. `BEGIN`
3. execute all record/event SQL through that exact client
4. `COMMIT`
5. release the client

If the callback or commit fails after `BEGIN`, the adapter attempts `ROLLBACK` before release. A rollback failure is surfaced as `RUNTIME_TRANSACTION_ROLLBACK_FAILED` with both the original and rollback errors retained.

## Safety rules

- Never run authoritative state mutation through independent pool queries.
- Never treat a failed or ambiguous commit as successful.
- Never swallow rollback failure.
- Always release the acquired client.
- The adapter does not own database credentials or database selection.
- GrowthOS still requires `GROWTHOS_DATABASE_URL`; it must not silently use Wiserr's application database URL.

## What this proves

Repository tests prove the transaction orchestration contract, including commit, rollback, rollback failure, and client release behavior.

## What this does not prove

This is not yet evidence that production PostgreSQL transactions work end-to-end. The following remain release gates:

- provision a real GrowthOS database/user
- execute the runtime migrations against it
- create the actual `pg.Pool` from `GROWTHOS_DATABASE_URL`
- run live integration tests
- force a failure between state write and event write and prove rollback
- restart a worker and recover state from the real database
- prove backup restoration

Do not mark those gates complete from unit tests alone.
