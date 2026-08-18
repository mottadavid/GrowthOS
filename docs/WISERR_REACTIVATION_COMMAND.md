# Wiserr Reactivation Command

## Purpose

GrowthOS decides whether a reactivation action should happen. Wiserr remains the authority that resolves final eligible recipients and performs communication.

The handoff between them must preserve the exact approved action **and** the execution-time revalidation result.

## Why the older request shape was insufficient

The original reactivation execution request used the plan's approved recipient ceiling:

```text
plannedMaxRecipients
```

But campaign revalidation may discover fewer currently eligible recipients immediately before execution.

If the command continues to carry the old maximum, the executor can accidentally use stale approval context.

## Command construction rule

`buildWiserrReactivationCommand()` recomputes campaign start readiness immediately before constructing the external command.

It requires:

- approved campaign and intact plan hash;
- approved/running experiment bound to that exact plan;
- canonical GrowthOS action bound to the plan and message hash;
- exact active envelope;
- tamper-evident policy receipt whose decision is `ALLOW`;
- pristine execution attempt bound to the exact action hash;
- current Wiserr snapshot;
- upstream authority decision `READY`.

Only a campaign start result of `READY` can produce a command.

## Recipient ceiling

The command uses:

```text
dispatchMaxRecipients = min(
  approved planned maximum,
  currently eligible recipients
)
```

It never restores or exceeds the approved maximum.

If current eligibility becomes zero, capacity becomes constrained/full, the channel capability is revoked, cohort semantics change, or upstream authority stops being ready, no Wiserr command is produced.

## Identity chain

The command binds:

```text
tenant
campaign
opportunity
experiment
plan + plan hash
campaign approval
policy receipt + hash
envelope + hash
action + action hash
execution attempt + idempotency key
original business snapshot
execution-time business snapshot
cohort definition/version
channel/account/geography
```

This lets Wiserr and GrowthOS reconcile the exact occurrence later.

## Message content

Unlike policy/audit receipts, the execution command necessarily carries the approved message content because Wiserr needs it to send.

Therefore:

- the command is operational/private data;
- do not emit the full command into normal logs;
- audit and telemetry should use IDs/hashes instead;
- Wiserr must still perform final recipient eligibility and compliance checks at execution time.

## Crash safety

The command carries the GrowthOS execution attempt's stable idempotency key. The external executor must preserve that identity and classify ambiguous outcomes rather than blindly retrying.

## Authority boundary

This command does **not** certify that Wiserr currently supports marketing reactivation. It is only the consumer-side contract.

Until Wiserr has an explicit certified reactivation execution capability, GrowthOS upstream authority must remain false and campaign revalidation must refuse the handoff.
