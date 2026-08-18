# Action Envelope Lifecycle Authority

GrowthOS does not decide who is an owner, administrator, or other human authority. That identity and permission truth belongs to Wiserr or another explicitly certified upstream authority.

GrowthOS owns a narrower question:

> Given a certified delegation assertion, is this exact autonomy envelope within the authority that was delegated, and can it remain executable without silently widening?

## Actors and subjects are different

A delegation assertion identifies a **granting actor**. An action envelope identifies a **delegate subject**.

Example:

```text
Wiserr owner authority
  grantingActorId = owner-123
        ↓
Autonomy delegation assertion
  may authorize delegateSubjectId = growth-strategist
        ↓
Action envelope
  delegateSubjectId = growth-strategist
        ↓
Action request
  requestedBy = growth-strategist
```

An owner authority assertion does not itself become permission for every GrowthOS agent.

## Autonomy levels are not ordinal

`L5_LOW_RISK_AUTONOMOUS` is not a blanket level above `L4_BOUNDED_AUTONOMOUS`.

A delegation assertion therefore carries an explicit `allowedAutonomyLevels` set. Permission for L5 does not imply L4 and vice versa.

## No wildcard by omission

Legacy control-plane envelopes historically treat an empty channel/account/geography list as unrestricted. Newly lifecycle-managed envelopes may not rely on that behavior.

Every new draft requires explicit non-empty:

- channels
- account IDs
- geographies

Future wildcard semantics, if needed, must be explicit rather than represented by an empty list.

## Lifecycle

```text
CERTIFIED EXTERNAL AUTHORITY
        ↓
AUTONOMY DELEGATION ASSERTION
        ↓
DRAFT ENVELOPE
        ↓ deterministic activation check
ACTIVE ENVELOPE
        ↓
REVOKED or EXPIRED
```

An active envelope is immutable.

Changing any consequential authority requires a new draft envelope. This includes widening or narrowing:

- delegate subject
- action family
- autonomy level
- channel/account/geography scope
- spend ceiling
- recipient ceiling
- change ceiling
- attempt ceiling
- validity window
- approval semantics

## Replacement

A material change creates a replacement draft with `replacesEnvelopeId`.

The replacement must independently pass the current delegation assertion. Activation returns:

1. the replacement as `ACTIVE`;
2. the prior envelope as `REVOKED` with replacement lineage.

This prevents in-place permission mutation.

## Activation rules

Activation fails closed unless all are true:

- envelope is `DRAFT`;
- delegation assertion is active and current;
- granting actor matches the assertion;
- assertion permits activation;
- tenant matches;
- delegate subject is explicitly allowed;
- action family is explicitly allowed;
- exact autonomy level is explicitly allowed;
- every channel/account/geography is within delegated scope;
- every numeric limit is at or below the delegated ceiling;
- envelope validity is fully contained within delegation validity.

## Revocation

Revocation requires a current delegation assertion that:

- belongs to the same tenant;
- identifies the acting granting actor;
- explicitly permits revocation;
- includes the envelope's delegate subject;
- includes the envelope's action family.

Expiration is time-derived and does not require a human actor.

## Auditability

Lifecycle receipts contain hashes and authority references rather than campaign/customer content.

Policy-decision receipts separately bind:

- exact action hash;
- exact envelope authority hash.

The envelope authority hash includes delegate identity and activation authority, so changing who may execute or which external assertion activated the envelope invalidates prior policy receipts.

## Separation of truth

Keep these ledgers distinct:

1. **Envelope lifecycle** — who delegated what authority and whether it is active.
2. **Policy decision** — why an exact action was allowed/refused.
3. **Execution attempt** — whether the external side effect happened.
4. **Growth outcome** — what happened in the business and how confidently it can be attributed.
