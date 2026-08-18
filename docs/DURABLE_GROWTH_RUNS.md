# Durable Growth Run Proof

## Purpose

A Growth Run Manifest is the immutable proof that one specific GrowthOS action came from one specific chain of persisted business evidence and authority.

The manifest must be reconstructable after process restart without relying on chat context, model memory, current mutable state, or caller-supplied domain objects.

## Required persisted lineage

The builder loads these records itself:

1. certified Wiserr growth snapshot;
2. source-derived reactivation opportunity evaluation;
3. approved reactivation campaign;
4. approved experiment;
5. durable policy authorization containing the exact action and the exact evaluated envelope snapshot;
6. durable execution attempt;
7. canonical durable business outcomes correlated to the run/campaign/experiment/action.

The caller supplies identities only. It does not supply the domain objects used to prove the run.

## Frozen authority rule

The action envelope used for historical proof is the exact envelope snapshot captured inside the durable policy authorization at evaluation time.

Do not use the envelope's current mutable record when building historical proof. The owner may legitimately revoke, expire, or replace that envelope after execution. That later safety action must not rewrite history or invalidate proof that the earlier action was authorized when evaluated.

The policy bundle therefore retains:

- exact action payload;
- exact action hash;
- exact evaluated envelope payload;
- exact envelope authority hash;
- deterministic policy receipt;
- business-state proof hash and compact summary.

## Manifest sealing

A persisted run manifest is immutable. Rebuilding the same `runId` must produce the exact same manifest and source proof.

If a later canonical business outcome appears after the manifest has already been sealed, attempting to rebuild the same `runId` with the expanded outcome set must fail with `DURABLE_GROWTH_RUN_MANIFEST_CONFLICT`.

This is deliberate. Historical proof is append-safe, not silently mutable. A future lifecycle can introduce explicit superseding/finalization records if multiple manifest stages are required; it must not mutate a sealed proof in place.

## Outcome identity

Business outcomes are recovered by the allowed run correlations:

- run ID;
- campaign ID;
- experiment ID;
- action ID.

Duplicate records found through multiple correlations are deduplicated by the durable business-outcome record ID, whose identity is based on tenant + source system + canonical upstream outcome ID.

## Privacy

The manifest and compact persistence event contain IDs, hashes, authority references, attempt state, and canonical outcome event IDs. They do not copy:

- campaign message bodies;
- recipient PII;
- private provider payloads;
- arbitrary business-state diagnostics.

Private source records remain in their purpose-specific durable records.

## Failure bias

Missing, inconsistent, tampered, cross-tenant, cross-source, or non-actionable source records fail closed.

A business outcome cannot be included unless the execution attempt is in a successful completed/reconciled-completed state, as enforced by the canonical Growth Run consistency validator.

## Current boundary

This proves GrowthOS runtime lineage semantics. Production readiness still requires the real PostgreSQL transaction/migration/restart/restore drills documented in the runtime persistence doctrine and the upstream Wiserr capabilities to be independently certified.
