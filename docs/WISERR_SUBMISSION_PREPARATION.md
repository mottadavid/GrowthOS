# Wiserr Submission Preparation

## Purpose

A persisted, approved command is still not permission to call an external transport immediately.

Before a worker is allowed to submit a Wiserr reactivation command, GrowthOS must prove all of the following:

1. the caller holds a bootstrapped `EXECUTION_ENABLED` runtime for the exact tenant;
2. the current capacity proof is still valid and exactly matches the authority bound into the immutable command;
3. the current Wiserr SMS execution authority is still `READY` and its lock fingerprint still matches the immutable command;
4. the campaign is `EXECUTING` from that exact persisted command; and
5. the exact execution attempt is `SUBMITTING`.

Only after these gates succeed may the preparation function return the command to a transport adapter.

A raw mutation-capable store is not execution authority, and historical command hashes are not a substitute for current authority.

## Runtime authority

`preparePersistedWiserrReactivationSubmission()` accepts the bootstrapped runtime rather than a raw store.

It calls `assertExecutionRuntime()` before authoritative execution. Therefore the process-level `GROWTHOS_EXECUTION_MODE` kill switch, startup database certification, and restart/recovery readiness remain load-bearing at the last boundary before external transport.

The runtime tenant must exactly match the requested tenant. A valid execution runtime for one tenant cannot be reused for another.

## Last-moment authority revalidation

The persisted command freezes the authority that existed when the command was constructed. That historical proof is necessary for auditability, but it is not sufficient for a later side effect.

Immediately before any campaign or attempt mutation, submission preparation validates a fresh current capacity proof and current SMS execution-authority decision.

The current capacity proof must:

- belong to the exact tenant;
- still be within its evidence validity window;
- still represent `AVAILABLE` capacity with no demand throttle;
- retain a `READY` capacity authority decision;
- exactly match the command-bound capacity bundle ID, proof hash, semantic hash, and authority hash.

The current SMS authority must:

- still be `READY` for `wiserr-reactivation-sms-v1`; and
- retain the exact command-bound authority lock fingerprint.

An expired capacity proof, changed capacity evidence/authority, revoked SMS authority, or changed SMS authority lock fails before campaign/attempt mutation.

## Ordering

```text
bootstrapped EXECUTION_ENABLED runtime
        ↓
persisted immutable command
        ↓
revalidate exact current capacity authority
        ↓
revalidate exact current SMS execution authority
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

This is the only resumable preparation window. No external call has yet been authorized, but current capacity and SMS authority must be revalidated again before the attempt can move to `SUBMITTING`.

### Attempt `SUBMITTING`

The command is never returned again by preparation. A prior worker may already have contacted Wiserr or its downstream provider. Retry would risk duplicate execution.

The caller must reconcile the external outcome instead.

The same conservative rule applies to `ACCEPTED` and `RECONCILIATION_REQUIRED` attempts.

## Invariants

- caller must hold an `EXECUTION_ENABLED` runtime;
- runtime tenant must match command/campaign tenant;
- raw store access is insufficient to authorize transport handoff;
- command is loaded from durable storage by ID, not reconstructed;
- historical command authority must be matched by fresh current capacity and SMS authority;
- authority revalidation happens before campaign/attempt mutation;
- command tenant/action/attempt/idempotency identity must match the durable attempt;
- campaign must match the exact persisted command;
- campaign transition happens before attempt `SUBMITTING`;
- transport cannot receive a command while the attempt is still `CREATED`;
- a command is not re-issued once the attempt has crossed into `SUBMITTING`;
- this layer does not perform the external send itself;
- this layer does not auto-reconcile ambiguous execution.

## Failure bias

The intentional failure bias is toward duplicate prevention and fail-closed execution.

A read-only or wrong-tenant runtime, expired/changed capacity proof, or revoked/changed SMS authority fails before authoritative mutation. A crash may leave a campaign `EXECUTING` while its attempt is still `CREATED`; this is recoverable before external contact only after fresh authorities are revalidated. A crash after `SUBMITTING` is treated as potentially externally consequential and therefore requires reconciliation rather than replay.
