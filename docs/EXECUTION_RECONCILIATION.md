# Execution Attempts and Reconciliation

## Purpose

Every external GrowthOS action that can create a durable side effect must have explicit attempt identity, idempotency, acceptance state, and uncertainty handling.

This applies to:

- outbound reactivation campaigns
- social publishing
- ad mutations
- review requests
- email/SMS/WhatsApp sends
- CMS/local profile changes
- future channel actions

## Core rule

> Unknown outcome is not failure and is not permission to retry.

A network exception after submission may mean the external system accepted the request even if GrowthOS did not receive confirmation. Retrying blindly could duplicate messages, posts, spend, or mutations.

## Attempt state model

```text
CREATED
  ↓
SUBMITTING
  ├──→ NOT_ACCEPTED
  ├──→ DEFINITIVE_FAILURE
  ├──→ ACCEPTED
  │       ├──→ COMPLETED
  │       └──→ RECONCILIATION_REQUIRED
  └──→ RECONCILIATION_REQUIRED
              ↓
       evidence / provider lookup
          ↙               ↘
RECONCILED_COMPLETED  RECONCILED_FAILED
```

## Invariants

1. Each attempt has an immutable attempt ID.
2. Each attempt has a stable idempotency key bound to tenant + action + exact action hash + attempt number.
3. The exact approved action hash is stored on the attempt.
4. A second attempt is blocked while any prior attempt is unresolved.
5. Unexpected exceptions default to `RECONCILIATION_REQUIRED`.
6. Only explicit evidence can reconcile an unknown outcome.
7. Reconciliation does not reset the attempt ceiling.
8. A known failed/not-accepted attempt may only be followed by another attempt when the action envelope allows another attempt and the action remains approved.
9. Channel adapters must never reinterpret suppression as provider failure.
10. External execution IDs must be retained whenever the authority/provider reports one.

## Why this is a cross-channel primitive

The same risk appears everywhere:

- SMS provider accepts a campaign but HTTP response times out.
- Social API publishes a post but connection closes before the post ID is returned.
- Meta accepts a budget mutation but the client receives a gateway timeout.
- Google Business Profile applies a change while GrowthOS loses the response.

The control plane decides whether an action is allowed. The execution-attempt ledger decides whether it is safe to try it again.
