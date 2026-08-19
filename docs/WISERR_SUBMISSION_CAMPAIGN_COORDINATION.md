# Wiserr Submission Result → Campaign Coordination

## Purpose

A durable Wiserr submission result changes more than the execution attempt. The campaign lifecycle must reflect what happened without replaying the external action or reconstructing authority.

`ingestWiserrReactivationSubmissionResultAndAdvanceCampaign()` composes the already-certified submission-result ingestion with the existing durable campaign state machine.

## Outcome mapping

```text
ACCEPTED
→ attempt ACCEPTED
→ campaign remains EXECUTING

COMPLETED
→ attempt COMPLETED
→ campaign OBSERVING

SUPPRESSED
→ attempt SUPPRESSED
→ campaign STOPPED

NOT_ACCEPTED
→ attempt NOT_ACCEPTED
→ campaign FAILED

DEFINITIVE_FAILURE
→ attempt DEFINITIVE_FAILURE
→ campaign FAILED

AMBIGUOUS
→ attempt RECONCILIATION_REQUIRED
→ campaign RECONCILIATION_REQUIRED
```

## Ordering

Before result ingestion mutates the attempt, the coordinator loads the exact durable command and campaign and proves that the campaign can legally accept that outcome.

Then:

1. persist/apply the exact Wiserr result through the canonical result-ingestion authority;
2. reload the durable campaign;
3. apply the deterministic campaign transition;
4. return only IDs/states, not customer message or provider payload data.

This avoids updating the attempt first and discovering afterward that the campaign is in an incompatible state.

## Crash recovery

The result receipt and attempt transition intentionally remain recoverable separately from the campaign transition.

If the process crashes after the durable result/attempt transition but before campaign advancement, exact result replay is idempotent and the coordinator finishes only the missing campaign transition. It never contacts Wiserr again.

## Replay rules

- `COMPLETED` replay is valid while campaign is already `OBSERVING` or later `COMPLETED`.
- `AMBIGUOUS`, `SUPPRESSED`, `NOT_ACCEPTED`, and `DEFINITIVE_FAILURE` replay only when the already-terminal campaign reason exactly matches the same durable result evidence.
- conflicting reasons fail closed.
- `ACCEPTED` is historical evidence only; it never regresses an `OBSERVING` or `COMPLETED` campaign back to `EXECUTING`.

## Failure bias

This layer never retries execution. Ambiguity becomes reconciliation, suppression becomes a non-failure stop, and deterministic delivery failures terminate the current campaign rather than inventing an autonomous retry path.
