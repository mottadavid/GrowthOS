# Runtime Recovery Inspection

## Purpose

A process restart must never cause GrowthOS to replay an external side effect merely because in-memory state disappeared.

`buildTenantRecoveryReport()` is a read-only startup/operations primitive. It inspects durable tenant state and identifies work that requires deterministic revalidation or reconciliation before unattended processing continues.

It does not mutate state and does not:

- retry an execution;
- submit an approved campaign;
- reconcile an ambiguous attempt;
- resume an experiment;
- expire or reactivate an envelope;
- call Wiserr or any external provider.

## Fail-closed rule

`safeForUnattendedRecovery` is true only when:

1. every inspected record-type scan is known complete; and
2. the report contains zero findings.

Any finding, including an `ATTENTION` finding, means unattended recovery is false.

## Execution attempts

The following durable states require attention after restart:

- `CREATED` — the external side effect has not been submitted by this attempt, but current authority/business state must be revalidated before any submit;
- `SUBMITTING` — external acceptance may be unknown; block and reconcile;
- `ACCEPTED` — provider/Wiserr accepted the command but final outcome is not known; block and verify/reconcile;
- `RECONCILIATION_REQUIRED` — explicitly blocking until evidence resolves the attempt.

Terminal attempts do not create recovery findings.

No unresolved attempt is automatically retried.

## Campaigns and experiments

Campaigns in `EXECUTING` or `RECONCILIATION_REQUIRED` and experiments in `RECONCILIATION_REQUIRED` are blocking findings.

Approved campaigns and open observation windows are attention findings. They must pass their normal current-state checks before work continues.

## Envelopes

An envelope still persisted as `ACTIVE` after `validUntil` is an attention finding. The deterministic control plane already refuses an expired envelope by time, but the durable record should be normalized through the explicit expiry lifecycle before unattended recovery is considered clean.

## Coverage

The V1 runtime store exposes bounded tenant-scoped record discovery with a hard maximum of 10,000 records per type. Recovery inspection uses that maximum.

If any scan returns exactly 10,000 records, coverage is marked potentially truncated and the report refuses to declare unattended recovery safe. A future paginated/count-backed store can remove this conservative ambiguity.

## Tenant boundary

Recovery inspection always requires an explicit tenant ID and performs only tenant-scoped record reads. There is no cross-tenant recovery scan in this primitive.

Tenant enumeration remains a hosting/Wiserr authority concern.

## Production gate

This report improves restart semantics but does not complete the production recovery gate. A real release still requires:

- actual PostgreSQL transaction wiring;
- migration execution;
- process restart drill;
- forced ambiguous-outcome reconciliation drill;
- backup restoration proof.
