# Execution Economics Ledger

## Purpose

GrowthOS must measure whether automation actually reduces cost and human effort without presenting estimates as facts.

The execution economics ledger records immutable, evidence-scoped cost and labor events for a growth run.

## Dimensions

Two kinds are currently supported:

- `COST_USD`
- `HUMAN_MINUTES`

Every event is separately classified as:

- `ACTUAL`
- `ESTIMATED`

These values are never automatically combined.

## Evidence requirements

`ACTUAL` requires an `evidenceRef`, such as a canonical provider/Wiserr billing or operator-time record.

`ESTIMATED` requires an `estimateBasisRef`, such as a versioned pricing table or planning model.

An estimate cannot become actual merely because a campaign completed.

## Correlation

An event must retain at least one growth identity:

- run ID;
- action ID;
- campaign ID;
- experiment ID.

V1 durable recovery uses the first available primary identity in this order: action, campaign, experiment, run. Cross-entity aggregation should use durable run lineage rather than unscoped tenant scans.

## Idempotency

`economicsEventId` is canonical. Exact replay is idempotent. Reusing the same ID with changed amount, certainty, category, correlation, source, or evidence is a hard conflict.

## Privacy

The compact runtime audit event contains only event identity, kind, certainty, amount, category, and semantic hash. It does not copy evidence references or arbitrary provider/customer payloads.

## Reporting rule

A report may show:

- actual cost;
- estimated cost;
- actual human minutes;
- estimated human minutes.

It must not sum actual + estimated into one number or convert human minutes to dollars unless a separate explicit valuation model is introduced and provenance is retained.
