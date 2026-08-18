# Durable Capacity Evidence Bundles

GrowthOS must not recreate operational headroom after restart from a prompt or a raw `authoritative: true` flag.

A durable capacity bundle preserves the exact capacity evidence, the external authority assertion that was evaluated against it, and the deterministic derived capacity state.

## Identity

```text
recordType = capacity_bundle
recordId   = SHA-256(tenantId + evidenceId + authorityId)
indexKey   = SHA-256(sourceSystem + sourceAuthority + scopeKey)
```

## Authority rule

`evaluateAndPersistCapacityBundle()` always runs the existing capacity-source authority evaluator. A bundle may be retained when authority is denied because denial is useful audit evidence, but only `assertCapacityBundleUsableForDemand()` can unlock demand planning, and it requires current `READY` source authority plus a derived `AVAILABLE` state with no throttle recommendation.

A source allowed to assert constraints but not availability can stop demand without manufacturing headroom.

## Time and restart behavior

Usability is re-evaluated at the time the bundle is consumed. A bundle that was `AVAILABLE` when stored cannot be reused after its source authority or evidence expires.

## Privacy

The durable record preserves source evidence required for provenance. Compact runtime events contain IDs, scope, authority decision, derived status, throttle state, and semantic hash; they do not copy raw signal source references into normal telemetry.

## Opportunity dependency

The first durable reactivation opportunity must reference both the exact durable Wiserr source snapshot and a current usable capacity bundle. It must not infer availability from the Wiserr snapshot while that upstream contract reports capacity `UNKNOWN`.
