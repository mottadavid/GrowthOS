# Wiserr Growth Snapshot Semantic Fingerprint

## Why

GrowthOS upstream receipts already record an `authorityFingerprint`, but a fingerprint is only useful when the semantic basis is explicit and reproducible.

Repository bytes are too noisy: an implementation-only TypeScript fix should not invalidate a contract. Conversely, a cohort, privacy, capability, or mount change must invalidate it even if a human considers the diff small.

## Canonical basis

`currentWiserrGrowthSnapshotProducerBasis()` records the V1 semantic contract GrowthOS depends on:

- actual guarded paths;
- explicit caller-supplied dormancy window;
- canonical lead `updated_at` activity authority;
- `won` exclusion;
- current channel-eligibility semantics;
- aggregate-only/no-recipient-PII privacy boundary;
- final recipient eligibility remains inside Wiserr;
- `PARTIAL` planning completeness;
- `UNKNOWN` capacity;
- current read-surface mount/auth status;
- explicit capability truth.

`wiserrGrowthSnapshotAuthorityFingerprint()` hashes only that normalized basis.

## Consequences

A change such as:

```text
GrowthSnapshotAggregateRow extends Record<string, unknown>
```

is implementation detail and does not change the semantic fingerprint.

Changes such as:

- different dormant cohort semantics;
- PII crossing the read boundary;
- capacity becoming authoritative;
- a mounted authenticated read surface;
- `readGrowthSnapshot` becoming certified;
- messaging/Luna/outcome authority becoming available;

must change the semantic basis and therefore the fingerprint.

## Current producer state

The current basis intentionally states:

```text
aggregateGrowthSnapshotProducer = true
readGrowthSnapshot = false
reactivationSmsExecution = false
reactivationEmailExecution = false
lunaCampaignContext = false
canonicalBookingOutcomeEvents = false
canonicalWonRevenueOutcomeEvents = false
```

The read surface is `UNMOUNTED`.

When the Wiserr pilot read route/service is implemented, the basis must be updated to include its exact auth authority and route/service identity. That semantic change should create a new fingerprint before the upstream receipt can be promoted.

## Guarded-path correction

The canonical document path is:

```text
docs/growth/GROWTHOS_READ_CONTRACT.md
```

The earlier candidate receipt incorrectly named `docs/growth/GROWTHOS_WISERR_AUTHORITY_CONTRACT.md`. Future receipt updates must use the executable basis rather than preserving that stale path.
