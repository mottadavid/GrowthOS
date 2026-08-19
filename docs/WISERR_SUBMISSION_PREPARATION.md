# Wiserr Submission Preparation

## Purpose

A persisted, approved command is still not permission to call an external transport immediately.

Before a worker is allowed to submit a Wiserr reactivation command, GrowthOS must durably establish both:

1. the campaign is `EXECUTING` from that exact persisted command; and
2. the exact execution attempt is `SUBMITTING`.

Only after both writes succeed may the preparation function return the command to a transport adapter.

## Ordering

`preparePersistedWiserrReactivationSubmission()` enforces:

```text
persisted immutable command
        ↓
load exact durable attempt
        ↓
if campaign APPROVED:
  campaign → EXECUTING from persisted command
        ↓
if campaign already EXECUTING from same attempt:
  safe crash-window resume
        ↓
attempt CREATED → SUBMITTING
        ↓
return exact persisted command to transport
```

## Crash windows

### Before campaign `EXECUTING`

No external call is authorized.

### Campaign `EXECUTING`, attempt still `CREATED`

This is the only resumable preparation window. No external call has yet been authorized, so deterministic preparation may continue by moving the exact attempt to `SUBMITTING`.

### Attempt `SUBMITTING`

The command is never returned again by preparation. A prior worker may already have contacted Wiserr or its downstream provider. Retry would risk duplicate execution.

The caller must reconcile the external outcome instead.

The same conservative rule applies to `ACCEPTED` and `RECONCILIATION_REQUIRED` attempts.

## Invariants

- command is loaded from durable storage by ID, not reconstructed;
- command tenant/action/attempt/idempotency identity must match the durable attempt;
- campaign must match the exact persisted command;
- campaign transition happens before attempt `SUBMITTING`;
- transport cannot receive a command while the attempt is still `CREATED`;
- a command is not re-issued once the attempt has crossed into `SUBMITTING`;
- this layer does not perform the external send itself;
- this layer does not auto-reconcile ambiguous execution.

## Failure bias

The intentional failure bias is toward duplicate prevention.

A crash may leave a campaign `EXECUTING` while its attempt is still `CREATED`; this is recoverable before external contact. A crash after `SUBMITTING` is treated as potentially externally consequential and therefore requires reconciliation rather than replay.
