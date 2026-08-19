# Runtime Startup Readiness

GrowthOS must not begin unattended authoritative execution merely because the process started successfully.

`inspectTenantStartupReadiness()` composes two independent release authorities:

1. runtime database certification
2. tenant runtime recovery inspection

The result is a read-only boot-time decision.

## Ready means both are clean

Startup is ready only when:

- the GrowthOS database matches the exact expected migrations/schema/indexes and passes the rollback probe; and
- the tenant recovery scan is complete and contains zero findings.

Any missing evidence, inspection failure, unresolved execution attempt, incomplete recovery coverage, stale active envelope, open campaign/experiment work, reconciliation requirement, or database certification issue blocks unattended authoritative execution.

## No automatic repair

This gate does not:

- run migrations
- retry an external action
- reconcile an ambiguous attempt
- expire or revoke an envelope
- start or resume a campaign
- close an experiment
- modify tenant/customer state

It reports why execution is not ready. Separate deterministic/operator workflows must resolve the blocker.

## API

- `evaluateStartupReadiness()` combines already-collected reports.
- `inspectTenantStartupReadiness()` runs database + recovery inspection.
- `assertTenantStartupReady()` throws `GROWTHOS_STARTUP_NOT_READY:<blockers>` when the tenant cannot safely enter unattended authoritative execution.

## Failure bias

A failed inspection is a blocker, not an implicit pass.

A database that cannot be inspected produces `DATABASE_INSPECTION_FAILED:*`.

A recovery store that cannot be inspected produces `RECOVERY_INSPECTION_FAILED:*`.

## Deployment use

An eventual GrowthOS worker should remain in read-only/non-executing mode until this gate passes for the tenant whose authoritative work it is about to process.

Passing this gate does not create external-channel authority. Wiserr/other upstream capability receipts, action envelopes, policy evaluation, capacity evidence, and execution-time eligibility remain independently load-bearing.
