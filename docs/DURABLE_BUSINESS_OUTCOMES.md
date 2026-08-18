# Durable Business Outcomes

GrowthOS learns from business outcomes only if the outcome evidence itself is durable and deduplicated correctly.

Webhook delivery IDs, queue-job IDs, and retry IDs are not business outcome identity. A booking, won job, sale, or revenue event must be keyed by the canonical ID from the system that owns that business fact.

## Runtime identity

```text
recordType = business_outcome
recordId   = SHA-256(tenantId + sourceSystem + canonicalOutcomeId)
indexKey   = growth correlationId
```

The source system is part of identity because two independent systems may legitimately use the same local outcome ID.

## Replay semantics

An exact replay of the same canonical outcome is idempotent even when the transport delivers it again later with a different webhook/job delivery identity.

Reusing the same tenant + source system + canonical outcome ID for different outcome semantics is a hard conflict. GrowthOS must not silently overwrite the original business fact.

## Attribution remains separate from execution

Persisting an outcome does not prove GrowthOS caused it. The canonical growth outcome event retains attribution confidence and evidence using the existing outcome-attribution contract.

`DIRECT` attribution still requires explicit evidence and a direct correlation ID. `UNATTRIBUTED` outcomes cannot smuggle a direct-correlation claim.

## Privacy

The durable outcome record retains the canonical outcome value because it may be required for revenue attribution and later analysis. That record is private runtime data.

The compact runtime evidence event does not repeat the full outcome value. It records an `outcomeValueHash` plus canonical outcome ID, type, source, attribution confidence, and semantic hash. Arbitrary private outcome detail must not be copied into normal logs or telemetry.

## Correlation recovery

Outcomes are indexed by the GrowthOS correlation ID so a completed run can recover the exact booking/sale/revenue evidence attached to that action without a cross-tenant or tenant-wide scan.

## Remaining upstream contract

For the first Wiserr loop, this repository is ready to consume canonical booking/sale facts, but Wiserr has not yet certified those outcome capabilities for GrowthOS. The upstream receipt must continue to report them false until a tested Wiserr event/read contract exists.

## Remaining production proof

This repository layer still depends on the runtime release gates in `docs/RUNTIME_PERSISTENCE.md`: real PostgreSQL transaction integration, migrations, restart/recovery drills, and backup restoration evidence before unattended client execution.
