# Durable transport fault evidence

When the GrowthOS → Wiserr transport throws after an attempt has entered `SUBMITTING`, the remote outcome is ambiguous. GrowthOS must preserve local evidence without copying private provider payloads or pretending the local exception is a canonical Wiserr result.

The transport-fault record stores only tenant/command/attempt identity, phase, error class/code, timestamp, and a semantic hash. Raw error messages, stacks, provider payloads, commands, recipient data, and message content are forbidden.

The production wrapper records this evidence first, then moves the durable attempt and campaign to `RECONCILIATION_REQUIRED`. It never retries transport. The evidence reference is `growthos://wiserr-transport-fault/<fault-id>` and is suitable for the existing reconciliation workflow.

If any persistence/transition step itself fails, the pre-existing `SUBMITTING`/`EXECUTING` states remain fail-closed and startup recovery will continue to block unattended replay.
