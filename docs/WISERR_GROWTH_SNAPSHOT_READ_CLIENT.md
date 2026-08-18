# Wiserr Growth Snapshot Read Client

## Purpose

GrowthOS must not call a Wiserr growth-snapshot endpoint merely because one exists.

A network route, service function, or successful response is transport availability. It is not authority.

The GrowthOS read client therefore places the upstream authority decision **before** the transport call.

```text
upstream authority receipt
+ current upstream commit
+ current authority fingerprint when upstream moved
        ↓
readGrowthSnapshot certified?
        ↓
NO → do not call transport
YES
        ↓
transport-neutral snapshot request
        ↓
schema + tenant + freshness validation
        ↓
validated snapshot + authority proof
```

## Required upstream capability

The client requires exactly:

```text
readGrowthSnapshot = true
```

`aggregateGrowthSnapshotProducer = true` is not enough.

A producer may exist in Wiserr while no authenticated mounted read surface exists. That state must remain non-executable from GrowthOS.

## Transport neutrality

The client accepts a transport function with the narrow input:

```js
{ tenantId, dormantDays }
```

The transport may later be implemented as:

- authenticated HTTP;
- internal service-to-service RPC;
- another certified boundary.

GrowthOS does not hard-code the choice before the Wiserr authority is proven.

## Post-response checks

Even a certified transport response is not blindly trusted.

GrowthOS validates:

1. the snapshot schema;
2. exact tenant identity;
3. `generatedAt` freshness;
4. unacceptable future clock skew.

A cross-tenant, stale, malformed, or materially future snapshot fails closed.

## Upstream movement

If Wiserr moves after the receipt's `validatedCommitSha`:

- no current semantic fingerprint → review required before transport;
- changed fingerprint → review required;
- reverified unchanged fingerprint → the read may remain authorized if the receipt itself is still certified/current.

This prevents unrelated Wiserr merges from forcing needless contract churn while still refusing stale assumptions.

## Privacy

The read client carries no customer recipient data by design. It requests the aggregate GrowthOS planning snapshot only.

## Current state

Until Wiserr exposes a mounted authenticated read boundary and the GrowthOS upstream receipt is promoted to `CERTIFIED` with `readGrowthSnapshot: true`, this client will refuse before any transport invocation.
