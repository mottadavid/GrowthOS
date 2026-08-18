# Durable Wiserr Growth Snapshots

The first GrowthOS revenue loop starts from business state owned by Wiserr. That source evidence must remain durable after it has been read, or later campaign/action/outcome proofs could be reconstructed against a different business snapshot.

## No generic snapshot write

GrowthOS does not expose a repository operation that accepts an arbitrary `{ snapshot, authority }` object and blesses it as source provenance.

`readAndPersistWiserrGrowthSnapshot()` always calls the certified Wiserr read client first. The read client must establish `readGrowthSnapshot` authority, tenant identity, schema validity, and freshness before the snapshot can be persisted.

## Runtime identity

```text
recordType = wiserr_growth_snapshot
recordId   = snapshotId
indexKey   = upstream dependencyId
```

The durable payload retains:

- the exact Wiserr snapshot;
- canonical snapshot SHA-256;
- upstream dependency ID;
- validated/current commit SHAs;
- semantic authority fingerprint;
- authority lock fingerprint.

## Replay and drift

An exact replay of the same snapshot is idempotent when its semantic upstream authority is unchanged. An unrelated upstream commit may move while the same reverified semantic fingerprint remains authoritative.

The same snapshot ID with different snapshot contents, a different semantic authority fingerprint, or a different authority lock is a hard conflict. GrowthOS does not overwrite source evidence in place.

## Privacy

The durable snapshot contains the bounded aggregate planning state returned by the Wiserr contract. It must continue to contain no recipient list, phone number, email address, transcript, or private customer content.

The compact runtime persistence event does not repeat cohort counts or channel eligibility. It carries snapshot ID/hash, authority fingerprints, generated time, completeness, and capacity status.

## Fail-closed rules

- uncertified upstream authority refuses before transport;
- cross-tenant responses are rejected;
- stale/future responses are rejected by the certified read client;
- snapshot hash is reverified after restart;
- stored authority proof is validated after restart;
- semantic drift under an existing snapshot ID refuses rather than mutating provenance.

## Current upstream status

This repository path is consumer-ready but cannot execute against Wiserr yet because the current Wiserr producer/read capability is still not certified. The checked-in upstream receipt must continue to keep `readGrowthSnapshot = false` until the authenticated read boundary is merged, tested, re-fingerprinted, and promoted.

## Relationship to the Growth Run Manifest

The durable Growth Run Manifest must eventually load this exact snapshot record. It must not reconstruct the source snapshot from the campaign plan or current Wiserr state because either would weaken provenance.

## Remaining production proof

This repository layer also depends on the runtime release gates in `docs/RUNTIME_PERSISTENCE.md`: live PostgreSQL transactions, migrations, restart/recovery drills, and backup restoration evidence before unattended client execution.
