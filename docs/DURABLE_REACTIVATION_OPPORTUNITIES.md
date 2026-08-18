# Durable Reactivation Opportunity Evaluations

GrowthOS must not persist a caller-supplied opportunity as truth. The first reactivation opportunity is derived from durable source evidence.

## Required sources

A durable evaluation loads:

1. the exact persisted Wiserr growth snapshot;
2. a persisted capacity evidence/authority bundle.

The Wiserr snapshot is rechecked for freshness at evaluation time. The capacity bundle is re-evaluated for current source authority and must be usable for demand (`READY + AVAILABLE + no throttle`).

Only then does GrowthOS compose the business-state view and run the deterministic dormant-lead detector.

## Identity

The evaluation record ID is derived from:

```text
snapshotHash
+ capacitySemanticHash
+ detectorPolicyHash
```

and is indexed by `snapshotId`.

Changing the detector threshold/rate policy creates a distinct evaluation rather than silently changing the meaning of an existing decision.

## Restart/current-evidence behavior

An existing evaluation is historical evidence, not permanent permission. The source snapshot freshness and capacity usability are rechecked before an existing evaluation can be returned for current planning. Expired capacity or a stale snapshot therefore blocks reuse.

## Decisions

All deterministic detector outcomes may be retained:

- `OPPORTUNITY`
- `NO_ACTION`
- `INSUFFICIENT_EVIDENCE`

This lets GrowthOS audit restraint as well as action.

## Privacy

The durable record contains source hashes and the detector result required for planning provenance. The compact runtime event records IDs, hashes, decision, reasons, and opportunity ID; it does not repeat the expected-impact object or source evidence internals.

## Growth Run dependency

A future durable Growth Run Manifest must load the exact opportunity evaluation and use its `result.opportunity`. It must not reconstruct the opportunity from the campaign or rerun the detector against newer business state.
