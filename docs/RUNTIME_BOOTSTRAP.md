# Runtime Bootstrap Authority

GrowthOS runtime health is not execution authority.

A process may have a valid database connection, current schema, clean migration checksums, and no unresolved runtime findings and still remain read-only.

## Modes

`bootstrapTenantRuntime()` produces exactly one runtime mode:

- `READ_ONLY`
- `EXECUTION_ENABLED`

Execution is enabled only when both conditions are true:

1. the caller explicitly supplies `executionRequested: true`; and
2. `inspectTenantStartupReadiness()` returns `ready: true`.

Any other combination is `READ_ONLY`.

## Read-only surface

Read-only mode exposes only:

- `getRecord`
- `listRecords`
- `listEvents`

It does not expose `putRecord`, `appendEvent`, `mutateRecordAndAppendEvent`, or another mutation-capable store surface.

## Execution surface

The mutation-capable atomic PostgreSQL runtime store is exposed only as `executionStore` when the runtime is `EXECUTION_ENABLED`.

Callers that require execution must use `assertExecutionRuntime(runtime)`. It throws `GROWTHOS_RUNTIME_EXECUTION_DISABLED` unless the runtime is explicitly execution-enabled.

## Fail-closed doctrine

GrowthOS must never infer execution authority from any of these facts alone:

- the database is reachable;
- migrations are current;
- rollback is certified;
- runtime recovery state is clean;
- an action envelope exists;
- an upstream transport exists.

Those are necessary operating conditions, not authorization to create side effects.

## Non-goals

The bootstrap does not:

- run migrations;
- repair database state;
- retry execution attempts;
- reconcile ambiguous outcomes;
- activate or widen autonomy envelopes;
- certify Wiserr capabilities;
- send messages or call external providers.

Those remain explicit authority paths elsewhere in GrowthOS/Wiserr.
