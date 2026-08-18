# Reactivation Campaign Authority

The reactivation plan defines what GrowthOS wants to do. The campaign authority governs whether that approved plan may execute now.

## Why this layer exists

Approval is not permanent permission.

Between approval and execution:

- business capacity can fill;
- an upstream Wiserr capability can be revoked or remain uncertified;
- the dormant-cohort definition can change;
- recipient eligibility can shrink to zero;
- the approved message/offer can be mutated;
- approval itself can expire.

GrowthOS therefore revalidates execution-time facts immediately before creating an external attempt.

## State machine

```text
DRAFT
  ↓
READY_FOR_APPROVAL
  ↓
APPROVED
  ↓
EXECUTING
  ├──→ OBSERVING → COMPLETED
  ├──→ FAILED
  └──→ RECONCILIATION_REQUIRED

APPROVED / EXECUTING / OBSERVING / RECONCILIATION_REQUIRED
  └──→ STOPPED
```

Illegal jumps fail closed.

## Approval binding

The campaign embeds the exact reactivation plan snapshot.

Approval records:

- approval ID;
- approving actor;
- approval timestamp;
- exact plan hash;
- optional expiry.

Any mutation to approval-bound plan fields after approval produces `REQUIRE_REAPPROVAL`.

## Execution-time revalidation

Immediately before dispatch, GrowthOS requires all of the following:

1. campaign status is `APPROVED`;
2. approved plan hash still matches exactly;
3. approval is not expired;
4. upstream authority decision is `READY`;
5. current Wiserr snapshot belongs to the same tenant;
6. current business state is complete for purpose;
7. current operational capacity is `AVAILABLE` and not throttled;
8. cohort definition ID/version still match the approved plan;
9. current channel capability is still enabled;
10. at least one recipient is currently eligible.

If the cohort definition changed, the correct result is reapproval, not silent audience drift.

If current recipient eligibility is lower than at approval time but the cohort semantics are unchanged, GrowthOS may dispatch fewer recipients than the approved maximum. It may never exceed the approved maximum.

## Start decisions

The deterministic pre-dispatch gate returns one of:

- `READY`
- `REQUIRE_REAPPROVAL`
- `DENY`
- `NO_ACTION`

Examples:

```text
capacity became FULL
→ NO_ACTION

upstream Wiserr authority is still CANDIDATE
→ DENY

cohort v1 became cohort v2
→ REQUIRE_REAPPROVAL

50 approved max, only 25 currently eligible
→ READY with dispatchMaxRecipients=25
```

## Relationship to execution attempts

Campaign state does not replace the execution-attempt ledger.

Once the campaign start gate returns `READY`:

```text
campaign
→ create exact execution attempt
→ mark campaign EXECUTING
→ external authority call
```

If the external result is ambiguous, both layers reflect uncertainty:

```text
execution attempt = RECONCILIATION_REQUIRED
campaign = RECONCILIATION_REQUIRED
```

No second external attempt is permitted until the first is reconciled.

## Relationship to GrowthOS learning

A campaign may enter `OBSERVING` only after dispatch execution is known sufficiently to observe downstream response.

Campaign completion does not itself claim success. Replies, bookings, won outcomes, and revenue attribution belong in the Growth Event / Outcome Ledger with explicit attribution confidence.

## Principle

> Approval authorizes a bounded plan. Execution-time evidence decides whether acting on that plan is still justified.
