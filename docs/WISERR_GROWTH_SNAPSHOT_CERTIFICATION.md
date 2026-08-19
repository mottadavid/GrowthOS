# Wiserr Growth Snapshot Certification

## Purpose

`wiserr-growth-snapshot-v1` must not become `CERTIFIED` merely because a route exists or because a pull request is green.

The mounted read capability is authority-bearing. Certification therefore requires retained evidence that the exact bounded contract is merged, current, tenant-isolated, privacy-bounded, and green on every required Wiserr gate.

## Required evidence

The certification evaluator requires all of the following:

- repository is exactly `mottadavid/Wiserr-OS`;
- the authenticated route has actually merged;
- the merged route commit is proven contained in the Wiserr main commit being certified;
- the current semantic authority fingerprint exactly matches `candidateWiserrGrowthSnapshotMountedBasis()`;
- the verified guarded-path set exactly matches the mounted semantic basis;
- canonical authentication and tenant isolation were explicitly verified;
- aggregate-only/no-recipient-PII response behavior was explicitly verified;
- separation from execution authority was explicitly verified;
- every required Wiserr gate succeeded on the exact route PR head.

Required gates:

1. `Tests Gate`
2. `Documentation Governance`
3. `Agent Authority Audit`
4. `gitleaks`
5. `Timeline Real-Store Gate`
6. `Chat Analytics QA`
7. `Quality Gate`

A green gate on another head does not count.

## Capability boundary

This certification path may grant only:

- `aggregateGrowthSnapshotProducer=true`
- `readGrowthSnapshot=true`

It must keep all of the following false:

- `reactivationSmsExecution`
- `reactivationEmailExecution`
- `lunaCampaignContext`
- `canonicalBookingOutcomeEvents`
- `canonicalWonRevenueOutcomeEvents`

Capacity is also not granted by this contract. GrowthOS continues to require a separate authorized capacity source.

## No automatic promotion

The evaluator is pure. It does not call GitHub, modify the checked-in receipt, call Wiserr, or promote authority automatically.

An operator/agent must first retain and verify the upstream evidence, then call `buildCertifiedWiserrGrowthSnapshotReceipt()`, review the resulting receipt, and update the checked-in authority receipt through the normal reviewed repository workflow.

## Upstream movement after certification

Certification binds the current Wiserr commit and semantic fingerprint. If Wiserr moves afterward, the generic upstream authority evaluator applies the existing rule:

- unknown moved fingerprint -> review required;
- changed semantic fingerprint -> review required;
- reverified unchanged semantic fingerprint -> the certified contract can remain usable according to the receipt policy.

This allows unrelated Wiserr changes without weakening semantic authority checks.
