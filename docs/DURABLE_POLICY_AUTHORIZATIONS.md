# Durable Policy Authorizations

A policy receipt is not enough by itself after restart. The exact action that produced the receipt must remain recoverable, or a caller could reconstruct a slightly different action and incorrectly treat the old approval as authority.

## Runtime identity

```text
recordType = policy_authorization
recordId   = receiptId
indexKey   = actionId
```

Each durable record contains the exact action, its canonical action hash, the exact policy receipt, the envelope identity/hash used by that receipt, and a hash + safe summary of the business state used during evaluation.

## No post-hoc ALLOW writes

GrowthOS does not expose a repository method that accepts an arbitrary caller-created policy receipt and stores it as authority.

`evaluateAndPersistPolicyAuthorization()` always:

1. validates the action, envelope, and business state;
2. runs the real deterministic control-plane evaluator;
3. creates the policy receipt from that decision;
4. proves receipt/action/envelope consistency;
5. atomically persists the exact authorization bundle and its compact evidence event.

This means `ALLOW`, `DENY`, `NO_ACTION`, and `REQUIRE_APPROVAL` are all retained as evidence of what the policy engine actually decided.

## Restart behavior

After restart, a real execution path must reload the durable action/receipt pair rather than recreate the action from model context. Before use, `assertDurablePolicyAuthorizationMatches()` proves the recovered action and current recovered envelope still match the recorded receipt.

## Business-state proof

Policy can depend on capacity and business-state freshness. The durable bundle stores a canonical hash of the evaluated business state and a compact summary containing only tenant, completeness, capacity status, and throttle state.

Arbitrary business-state fields are not copied into the compact policy event.

## Privacy

The durable record contains the exact action because that is the authority being preserved. Callers must treat action inputs as private runtime data. Policy events intentionally contain only IDs, hashes, decision reasons, spend/recipient summary, and business-state proof. They must not dump arbitrary action inputs into logs or telemetry.

## Remaining production proof

This repository layer still depends on the runtime release gates in `docs/RUNTIME_PERSISTENCE.md`, including real PostgreSQL transaction integration, migrations, restart/recovery drills, and backup restoration evidence before unattended client execution.
