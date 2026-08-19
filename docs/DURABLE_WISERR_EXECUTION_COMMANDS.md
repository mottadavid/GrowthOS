# Durable Wiserr Execution Commands

## Purpose

A validated execution command is consequential authority. GrowthOS must not reconstruct that command from current campaign, policy, capacity, or upstream state after a process crash.

The exact command that was approved for handoff is therefore persisted before campaign execution/submission begins.

## Durable identity

- record type: `wiserr_reactivation_command`
- record ID: exact `commandId`
- secondary index: exact `actionId`
- payload: exact validated command plus a canonical semantic hash

The record is immutable. Exact replay is idempotent; reusing the same command ID with changed content is a hard conflict.

## What the command binds

The persisted command already binds:

- tenant/action/campaign/experiment/plan
- exact campaign approval
- exact policy receipt and envelope authority
- execution attempt and idempotency identity
- original and execution-time business snapshots
- cohort definition/version and current dispatch ceiling
- capacity bundle/proof/semantic/authority hashes
- Wiserr SMS execution dependency and lock fingerprint
- approved message and frequency policy

## Privacy

The durable runtime record contains the exact command because Wiserr needs the exact approved message for execution. This data belongs in the runtime database, never Git.

The append-only evidence event deliberately excludes message copy and retains only IDs, hashes, authority references, attempt identity, and dispatch ceiling.

## Restart behavior

Production orchestration should use `startDurableReactivationCampaignFromPersistedCommand`.

A restart may recover by `commandId` and continue deterministic reconciliation from the exact pre-crash authority object. It must not rebuild a new command from current state and pretend it is the old command.

Missing, corrupted, cross-tenant, or cross-campaign commands fail closed.

## Invariant

> Construct and validate the exact command, persist it immutably, then transition toward external execution. Never reconstruct consequential execution authority after a crash.
