# Wiserr Submission Result Ingestion

## Purpose

GrowthOS must not let a transport adapter mutate execution attempts directly.

After an exact reactivation command has crossed the pre-submission boundary and the durable attempt is `SUBMITTING`, Wiserr returns a canonical result classification. GrowthOS persists that exact result evidence first, then deterministically applies it to the exact durable attempt.

## Canonical result outcomes

The V1 GrowthOS boundary recognizes only:

- `ACCEPTED`
- `COMPLETED`
- `SUPPRESSED`
- `NOT_ACCEPTED`
- `DEFINITIVE_FAILURE`
- `AMBIGUOUS`

GrowthOS does not infer these classifications from provider strings. Wiserr remains responsible for translating its canonical messaging/compliance/provider behavior into one of these outcomes.

`SUPPRESSED` is reserved for canonical Wiserr refusal caused by compliance, opt-out, DNC, kill-switch, or another non-send suppression class. The exact Wiserr classification is preserved as evidence. GrowthOS intentionally does not copy Wiserr's internal suppression-code registry.

## Privacy boundary

A result may contain only compact execution evidence:

- result ID
- tenant ID
- command ID
- attempt ID
- canonical outcome
- canonical classification
- evidence reference
- optional external execution ID
- observation timestamp

It must not embed:

- message copy
- recipient PII
- raw provider payloads

## Durable ordering

The inbound boundary is:

```text
Wiserr canonical result
        ↓
validate tenant/command/attempt identity
        ↓
persist exact immutable result receipt
        ↓
apply deterministic attempt transition
```

This ordering intentionally creates a safe crash window.

If the process dies after the result receipt is durable but before the attempt transition, restart recovery can detect `PERSISTED_RESULT_APPLY_DETERMINISTICALLY` and re-apply the exact local evidence. It must not re-submit the command or contact the external provider again.

## Idempotency

The same `resultId` with identical semantics is idempotent.

The same `resultId` with changed semantics is a hard conflict.

A distinct `COMPLETED` result may legitimately follow an earlier `ACCEPTED` result for the same attempt. A direct `COMPLETED` result received while the attempt is still `SUBMITTING` records acceptance first and then completion, so a crash between those two durable transitions leaves the system in the conservative `ACCEPTED` state.

## State mapping

- `ACCEPTED` → `ACCEPTED`
- `COMPLETED` → `ACCEPTED` if necessary, then `COMPLETED`
- `SUPPRESSED` → `SUPPRESSED`
- `NOT_ACCEPTED` → `NOT_ACCEPTED`
- `DEFINITIVE_FAILURE` → `DEFINITIVE_FAILURE`
- `AMBIGUOUS` → `RECONCILIATION_REQUIRED`

Ambiguity never becomes an ordinary retryable failure.

## Invariant

> GrowthOS persists the exact canonical Wiserr result before applying it, never reconstructs provider outcomes, never retries an ambiguous external side effect, and never lets raw provider payloads become runtime authority.
