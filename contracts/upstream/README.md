# Upstream Authority Receipts

These files record the external contracts GrowthOS depends on.

They are **not** general integration notes. They are executable authority evidence consumed by the upstream-authority controls.

Rules:

- `OBSERVED` records inspected behavior only.
- `CANDIDATE` may describe a branch/PR, but cannot unlock production capability.
- `CERTIFIED` means the upstream contract is canonical under that repository's gates and its authority fingerprint has been verified.
- `REVOKED` denies use.

Capabilities are explicit booleans. Missing or false capability means GrowthOS must not use it.

When an upstream repository moves, reverify the relevant authority fingerprint before relying on a prior receipt. Do not simply replace `validatedCommitSha` with the newest commit without re-reading the guarded paths.

See `docs/MERGE_COORDINATION.md`.
