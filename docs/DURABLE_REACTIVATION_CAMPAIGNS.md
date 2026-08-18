# Durable Reactivation Campaigns

The first GrowthOS revenue loop must survive process restart without losing campaign approval, execution, reconciliation, observation, or completion state.

## Record identity

Durable reactivation campaigns use:

```text
recordType = reactivation_campaign
recordId   = deterministic campaign ID from exact plan ID + approval hash
indexKey   = plan approval hash
```

The plan approval hash is immutable for the lifetime of the durable campaign record.

## Creation

Creation is deterministic and idempotent for the exact approved plan. Replaying creation after a lost response returns the existing campaign rather than creating a second campaign.

A materially different plan has a different approval hash and therefore a different durable campaign identity.

## Approval provenance

The pure campaign model can retain an optional `approvalAuthorityRef` for compatibility with older callers.

The durable production path requires it.

GrowthOS does not decide whether an actor is an owner/admin merely because an ID was supplied. The stored authority reference must eventually point to the certified Wiserr or other upstream authorization evidence that allowed the approval.

## Execution ordering

The durable campaign does **not** move from `APPROVED` to `EXECUTING` by independently deciding that sending is safe.

The required ordering is:

```text
APPROVED durable campaign
        ↓
current Wiserr snapshot + upstream authority
        ↓
GrowthOS policy receipt + pristine execution attempt
        ↓
build exact Wiserr reactivation command
        ↓
command cross-checked against durable approved campaign
        ↓
atomically persist campaign = EXECUTING + command evidence event
        ↓
submit command to Wiserr execution authority
```

The command builder owns execution-time revalidation. The durable campaign transition proves the resulting command still matches the exact approved campaign.

## Forged-but-self-consistent command defense

A command's own `commandHash` proves only that the command has not changed since that hash was computed. It does not prove the command is the one authorized by the campaign.

Before entering `EXECUTING`, the durable campaign cross-checks:

- tenant and campaign ID;
- plan ID and plan approval hash;
- campaign approval ID;
- opportunity ID;
- original business snapshot ID;
- cohort definition ID/version;
- channel;
- approved message canonical hash;
- execution recipient ceiling must not exceed the approved plan maximum.

Therefore a caller cannot alter the command, recompute a valid command hash, and bypass campaign approval.

## Atomic state and evidence

Every durable campaign transition uses the atomic runtime mutation layer:

```text
record compare-and-swap
+
durable evidence event
=
one atomic mutation
```

No campaign transition may commit without its evidence event, and no event may claim a transition that failed its state CAS.

## Event privacy

Durable campaign events retain only operational evidence such as:

- campaign ID;
- plan ID/hash;
- opportunity ID;
- state;
- approval ID;
- attempt count;
- approval authority reference on approval;
- command ID/hash, attempt ID, execution snapshot ID, and dispatch ceiling when entering execution.

The approved message body is deliberately excluded from campaign lifecycle events.

## Recovery

The repository supports:

- exact campaign load by tenant + campaign ID;
- exact-plan discovery by tenant + record type + plan approval hash;
- restart recovery of approval/execution/reconciliation/observation/completion state;
- payload-hash validation and campaign/plan/index identity checks on every recovery.

## Terminal / uncertainty behavior

The durable repository mirrors the pure campaign state machine:

- `EXECUTING → OBSERVING → COMPLETED` for known successful dispatch progression;
- `EXECUTING → RECONCILIATION_REQUIRED` for ambiguous execution;
- manual `STOPPED` where the underlying campaign transition permits it;
- `FAILED` for definitive failure states.

A restart does not convert ambiguous execution into retry permission.

## Remaining production proof

This repository layer still depends on broader runtime release gates:

1. real PostgreSQL transaction integration;
2. controlled migrations;
3. restart/recovery drill against PostgreSQL;
4. ambiguous-outcome reconciliation drill;
5. backup/restore evidence;
6. certified Wiserr read/execution authorities.

Until those are complete, the durable campaign path is structurally ready but not authorized for unattended client sends.
