# Reactivation Observation Close

## Purpose

A campaign reaching `OBSERVING` means execution is known enough to measure; it does not mean the campaign should be marked successful or complete by hand.

`evaluateReactivationObservationAndCloseCampaign()` binds campaign closure to the exact durable experiment referenced by the persisted Wiserr command and to the experiment's retained evidence.

## Lifecycle

```text
campaign OBSERVING
+ exact command
+ exact durable experiment
+ evidence-backed observation
        ↓
experiment evaluation
```

If evidence is insufficient:

```text
experiment OBSERVING
campaign OBSERVING
```

If the experiment closes:

```text
SUCCESS      → experiment COMPLETED   → campaign COMPLETED
FAILURE      → experiment COMPLETED   → campaign COMPLETED
INCONCLUSIVE → experiment INCONCLUSIVE → campaign COMPLETED
STOP_GUARDRAIL → experiment STOPPED   → campaign STOPPED
```

Campaign `COMPLETED` means the governed campaign lifecycle is operationally finished. It does **not** mean the experiment succeeded. The experiment retains `SUCCESS`, `FAILURE`, or `INCONCLUSIVE` as the learning result.

## Identity binding

The coordinator loads the immutable persisted Wiserr command and requires:

- exact tenant;
- exact campaign ID;
- exact experiment ID;
- experiment opportunity ID equals the command opportunity ID;
- experiment business snapshot equals the command's original business snapshot.

An unrelated experiment therefore cannot be attached to a campaign after execution.

## Evidence

The experiment evaluator remains authoritative for:

- minimum sample size;
- observation horizon;
- primary metric;
- success criterion;
- guardrails;
- exposure ceiling;
- spend ceiling;
- retained evidence references.

The coordinator does not reinterpret those rules.

## Crash recovery

Experiment closure and campaign closure are separate durable transitions.

If the process crashes after the experiment closes but before the campaign transition, replay loads the terminal experiment and applies only the missing campaign transition. It does not require the caller to reconstruct or resubmit the original observation.

Once both are terminal, replay is idempotent.

## Failure bias

This layer cannot:

- mark an open experiment successful without minimum evidence;
- turn an inconclusive experiment into success;
- continue after a guardrail stop;
- replace the experiment referenced by the command;
- reopen a terminal campaign;
- create or repeat an external execution.
