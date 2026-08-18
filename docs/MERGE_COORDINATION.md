# Merge Coordination and Upstream Authority Locks

GrowthOS depends on fast-moving authorities in Wiserr OS and AI Studio. Concurrent delivery is expected. Stale assumptions are not.

This document is mandatory context for any work that reads, writes, or depends on another repository.

## Core rule

> A remembered or previously inspected upstream behavior is not current authority.

Before material cross-repo integration work, inspect the current upstream head, relevant open pull requests/trains, and the exact authority surface being consumed.

## Upstream authority states

GrowthOS distinguishes:

- `OBSERVED` — behavior was inspected, but no candidate contract exists.
- `CANDIDATE` — a branch/PR defines the intended contract but has not become certified authority.
- `CERTIFIED` — the contract is merged/accepted under its repository's required gates and its authority fingerprint has been recorded.
- `REVOKED` — the contract must no longer authorize GrowthOS behavior.

Only `CERTIFIED` authority may unlock production execution capabilities.

A draft or green pull request is still `CANDIDATE` until the upstream repository's merge/authority process makes it canonical.

## Required cross-repo preflight

Before changing an integration:

1. Read GrowthOS canonical docs and this file.
2. Inspect the current GrowthOS `main` head and open GrowthOS PRs.
3. Inspect the current upstream `main` head.
4. Inspect open upstream PRs/trains that touch or may supersede the relevant authority.
5. Identify the exact files/contracts that own the behavior.
6. Classify overlap:
   - `NONE` — no active work touches the authority.
   - `ADJACENT` — active work is nearby but does not alter the contract.
   - `OVERLAPPING` — active work may change the contract or composition path.
7. If overlap is `OVERLAPPING`, prefer an isolated GrowthOS-side contract/hardening slice rather than modifying shared upstream composition.
8. Record or update an upstream authority receipt.
9. Run exact-head CI for the GrowthOS branch.
10. Immediately before merge, re-check upstream and GrowthOS heads. If the upstream authority moved, revalidate the fingerprint before proceeding.

## Authority fingerprints

A repository commit SHA is useful evidence, but it is too broad to be the only contract lock: unrelated merges move `main` constantly.

An upstream authority receipt therefore records both:

- `validatedCommitSha` — where the authority was inspected/certified;
- `authorityFingerprint` — SHA-256 of the normalized contract surface/evidence that GrowthOS depends on.

If upstream `main` moves:

- same verified authority fingerprint → the dependency may remain ready;
- unknown fingerprint → review required;
- changed fingerprint → review required;
- revoked/missing required capability → deny.

GrowthOS must never silently assume that an unrelated-looking upstream merge left its contract unchanged when the fingerprint has not been checked.

## Guarded paths

Every receipt names `guardedPaths`: upstream files or contract surfaces that must be included in the re-audit.

Examples for the first Wiserr reactivation loop may include:

- canonical lead/contact store and opt-out authority;
- outbound messaging authority;
- GrowthOS snapshot producer;
- Luna/conversion handoff contract;
- canonical booking/outcome event authority.

Guarded paths are not permission for GrowthOS to edit those files. They describe what must be inspected when validating the dependency.

## Capability truth

A capability is an explicit boolean in the receipt. Absence is not permission.

Examples:

```text
readGrowthSnapshot = true
reactivationSmsExecution = false
lunaCampaignContext = false
canonicalBookingOutcomeEvents = false
```

A consumer must request the exact capabilities it requires. If a required capability is false or absent, the decision is `DENY`, not "probably supported."

## Merge-congestion policy

When Wiserr has several concurrent trains:

- avoid editing shared composition files unless the slice cannot be completed elsewhere;
- prefer domain/service contracts, schemas, tests, and adapters with small ownership surfaces;
- do not stack GrowthOS integration work on an unrelated feature train;
- do not merge a GrowthOS consumer that claims an upstream capability merely because an upstream draft PR intends to add it;
- keep execution capability false until the upstream authority is certified;
- use separate branches for separate concerns so one blocked upstream dependency does not block independent GrowthOS hardening.

## Merge gates

A GrowthOS cross-repo integration slice is mergeable only when:

1. its own exact-head CI is green;
2. its upstream assumptions are recorded;
3. any execution-enabling upstream capability is `CERTIFIED`;
4. the upstream authority fingerprint is current or reverified;
5. no unresolved overlapping upstream PR makes the contract ambiguous;
6. docs/tracker state match code.

## Current first-loop example

The Wiserr GrowthOS snapshot producer is being developed separately from GrowthOS. Until it becomes canonical and its read surface is mounted behind a certified auth contract, GrowthOS must treat it as a candidate dependency.

Likewise, Wiserr's existing transactional/follow-up SMS authority is not automatically a certified marketing-reactivation capability. GrowthOS must not relabel or reuse an unrelated purpose to bypass that distinction.

## Why this exists

The intended architecture has multiple teams/agents moving simultaneously. Without explicit upstream locks, an agent can correctly inspect a repository at 10:00, build for several hours, and merge against a different authority at 14:00.

That is a context-drift failure at the repository level.

GrowthOS treats upstream contract drift the same way it treats provider ambiguity and budget authority: **detect it, fail closed, and reconcile from evidence.**
