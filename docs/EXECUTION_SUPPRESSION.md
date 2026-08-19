# Execution Suppression

## Purpose

GrowthOS must preserve Wiserr's distinction between a communication suppression and an execution failure.

Wiserr's canonical SMS authority treats opt-out, compliance, purpose, and kill-switch refusals as deliberate safety behavior. A suppressed message is not a failed provider send and must not be retried as though a transient transport error occurred.

## GrowthOS state

Execution attempts therefore have an explicit terminal state:

`SUPPRESSED`

A suppressed attempt retains a compact canonical classification and optional evidence reference. It does not carry a synthetic failure error.

Once any attempt for an action is `SUPPRESSED`, `assertExecutionAttemptAvailable()` refuses every later attempt for that same action with:

`EXECUTION_SUPPRESSED_RETRY_FORBIDDEN`

This remains true even when the original action envelope allowed more than one attempt.

## Cross-repo authority rule

GrowthOS must **not** copy Wiserr's internal list of suppression error codes.

Wiserr explicitly owns suppression classification in its canonical communication adapter. Maintaining the same code list in GrowthOS would create two compliance authorities that can drift.

The future Wiserr GrowthOS execution boundary must therefore return an explicit canonical suppression classification/evidence result. GrowthOS may consume that classification and persist `SUPPRESSED`; it must not infer suppression from its own duplicated error-code allowlist.

## Durable behavior

`markDurableExecutionSuppressed()` persists the terminal state and an append-only evidence event. After restart:

- the attempt remains `SUPPRESSED`;
- the attempt is not considered ambiguous;
- another attempt for the same action is forbidden;
- the compact event retains classification/evidence reference but not customer message content.

## Deliberate non-claim

This layer does not yet define the future Wiserr campaign/batch execution response contract. It only gives GrowthOS the correct durable state needed once Wiserr returns an authoritative suppression classification.
