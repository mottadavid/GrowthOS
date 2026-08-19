# Reactivation Execution Preflight

## Purpose

GrowthOS must not collapse planning evidence, operational capacity, and communication authority into one business-state object.

The first reactivation execution path therefore requires three independent proof families:

1. **Wiserr growth snapshot** — cohort definition, current aggregate eligibility counts, tenant identity, and freshness.
2. **Capacity execution proof** — current externally authorized operational headroom derived from a durable capacity bundle.
3. **Wiserr channel execution authority** — explicit certified permission for GrowthOS to execute the requested communication family.

For SMS, the execution dependency is `wiserr-reactivation-sms-v1`.

## Planning is not sending

A Wiserr snapshot may truthfully report:

- `completeness: PARTIAL`
- `capacity.status: UNKNOWN`
- `eligibleByChannel.sms > 0`
- `capabilities.reactivationSms: false`

and still be useful planning evidence.

`eligibleByChannel.sms` means records exist in the bounded cohort that currently satisfy the aggregate planning filters. It does **not** mean GrowthOS has permission to send them marketing SMS.

A reactivation plan may therefore be drafted from eligible-count evidence without SMS execution authority. Execution remains impossible until the independent execution authority is certified.

## Capacity is external authority

The Wiserr growth snapshot is not permitted to manufacture universal operational capacity.

A campaign may execute only with a valid capacity execution proof derived from a durable capacity bundle whose current source authority permits that exact source/scope to assert availability.

The proof binds:

- tenant
- durable capacity bundle ID
- semantic hash
- evidence ID
- authority ID and authority hash
- source system and source authority
- scope key
- evidence time window
- derived status
- authority decision
- proof hash

An optimistic `snapshot.capacity = AVAILABLE` cannot replace this proof.

## Execution preflight

`evaluateReactivationExecutionPrerequisites` is read-only and side-effect free.

It returns `READY` only when all of the following are true:

- snapshot belongs to the tenant
- snapshot is not stale/unavailable
- capacity proof is intact, current, tenant-matched, authority-ready, and `AVAILABLE`
- exact channel execution authority is ready
- current eligible recipient count for the requested channel is greater than zero

Failure is conservative:

- stale/unavailable business state → `NO_ACTION`
- expired/not-yet-valid/unavailable capacity → `NO_ACTION`
- missing/tampered/cross-tenant capacity proof → `DENY`
- missing/wrong SMS authority → `DENY`
- zero current eligible recipients → `NO_ACTION`

## Command binding

The final Wiserr command binds both authority families independently:

- capacity bundle ID
- capacity proof hash
- capacity semantic hash
- capacity authority hash
- SMS execution dependency ID
- SMS execution authority lock fingerprint

These fields are part of the command hash. Mutating any of them after command construction invalidates the command.

## Invariant

> Business evidence is not capacity authority. Capacity authority is not communication authority. Communication authority is not campaign approval. Every boundary must remain independently provable at execution time.
