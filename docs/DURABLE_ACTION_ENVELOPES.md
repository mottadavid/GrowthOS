# Durable Action Envelopes

Action envelopes are execution authority. Losing, reviving, or widening an envelope after process restart is therefore a safety failure, not an ordinary cache miss.

## Runtime identity

Durable envelope state is stored as:

```text
recordType = action_envelope
recordId   = envelopeId
indexKey   = SHA-256(delegateSubjectId + actionFamily)
```

The secondary recovery key is tenant-scoped by the runtime store. It exists so GrowthOS can recover the current authority history for one delegate and one action family without scanning unrelated tenant state.

## External authority remains external

GrowthOS does not decide who is allowed to grant autonomy. Activation and revocation require an externally issued `AutonomyDelegation` assertion. The durable record retains the assertion ID/hash and the compact lifecycle event retains issuer authority evidence.

A process restart does not recreate or infer authority. It reloads the durable envelope and evaluates its current state.

## Authoritative transitions

Create, activate, revoke, and expire transitions use the atomic runtime mutation primitive. State and its compact evidence event must commit together.

Active envelope state is immutable. Material changes use a replacement envelope rather than editing the active authority in place.

## Replacement failure bias

Replacing an active envelope crosses two records. V1 deliberately chooses a fail-safe ordering:

```text
1. construct and validate replacement DRAFT
2. persist replacement DRAFT
3. revoke old ACTIVE envelope
4. activate replacement
```

The replacement is proven within the same current external delegation before step 3.

If the process fails after step 3 and before step 4, the safe durable state is:

```text
old envelope = REVOKED
replacement  = DRAFT
```

This temporarily reduces autonomy. It must never leave two active grants or silently restore the revoked grant.

The operation may be resumed from evidence after the replacement draft and revocation are recovered.

## Fail-closed invariants

- tenant, envelope ID, delegate subject, and action family are durable identity;
- the recovery index must match delegate + action family;
- activation cannot exceed externally delegated levels, scopes, limits, or validity;
- revocation requires current external revocation authority;
- expiry is derived from the envelope validity window;
- a revoked or expired envelope remains terminal after restart;
- scope widening is rejected before old authority is revoked;
- policy evaluation must use the recovered durable envelope, not a cached prior copy.

## Evidence privacy

Lifecycle events contain authority IDs/hashes, state, delegate, action family, autonomy level, and lineage. They must not contain campaign copy, customer PII, provider secrets, or unrelated private business data.

## Remaining production proof

This repository layer does not by itself certify a production database. Live execution still requires the runtime release gates in `docs/RUNTIME_PERSISTENCE.md`, including real PostgreSQL transactions, migrations, restart/recovery drills, and backup restoration evidence.
