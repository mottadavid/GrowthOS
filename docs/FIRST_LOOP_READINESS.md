# First-loop readiness report

## Purpose

Before GrowthOS attempts the first real owned-demand reactivation loop, operators need one deterministic answer to a narrower question than general system health:

> Are the independent authorities required to execute this tenant's first loop ready right now?

`evaluateFirstLoopReadiness()` is read-only. It does not create campaigns, mutate runtime state, promote upstream authority, or send a message.

## Independent prerequisites

The report intentionally keeps four proofs separate:

1. **GrowthOS runtime execution authority** — the tenant runtime must already be `EXECUTION_ENABLED`.
2. **Wiserr business-state read authority** — `wiserr-growth-snapshot-v1` must be certified for `readGrowthSnapshot` against the current audited contract.
3. **Capacity authority** — a current tenant-scoped capacity execution proof must independently establish usable headroom.
4. **Wiserr SMS execution authority** — `wiserr-reactivation-sms-v1` must independently be certified for `reactivationSmsExecution`.

No prerequisite substitutes for another. In particular:

- a working Wiserr SMS adapter does not certify marketing reactivation;
- aggregate recipient eligibility does not certify permission to send;
- a certified read contract does not certify SMS execution;
- a business snapshot does not certify capacity;
- a healthy database does not enable execution when the runtime is read-only.

## Decisions

The report returns only:

- `READY` — all four independent prerequisites are currently usable;
- `BLOCKED` — at least one prerequisite is missing, stale, moved, invalid, or disabled.

Blockers retain a layer and deterministic code so an operator can see whether the missing authority is runtime, business-state read, capacity, or SMS execution.

## Current expected production state

Until Wiserr's authenticated growth-snapshot read surface and GrowthOS marketing/reactivation SMS authority are separately certified, a real production readiness report is expected to remain `BLOCKED`.

That is correct behavior. The report must never convert roadmap intent, a draft PR, an observed adapter, or a candidate authority receipt into execution permission.
