# Durable Experiments

Experiments are part of GrowthOS decision authority. Losing their approval, guardrails, observation horizon, or closure evidence after restart would let the system retest a changed hypothesis or overrun an approved exposure envelope.

## Runtime identity

```text
recordType = experiment
recordId   = experimentId
indexKey   = actionPlanHash
```

The secondary index binds experiment recovery to the exact approved action plan rather than a tenant-wide scan.

## Approval integrity

The underlying experiment approval hash binds:

- hypothesis;
- opportunity and business snapshot;
- action-plan reference/hash;
- primary metric and success criterion;
- guardrails;
- minimum sample size;
- observation horizon;
- maximum exposure;
- maximum spend.

The durable approval transition requires an external `approvalAuthorityRef`. GrowthOS does not infer who may approve an experiment.

## Evaluation discipline

Durability does not weaken experiment doctrine:

- promising early data cannot close the experiment before minimum evidence;
- spend/exposure or business guardrails may stop it immediately;
- observations must retain evidence references from the growth/outcome ledger;
- missing primary evidence becomes `INCONCLUSIVE`, not guessed success or failure;
- ambiguous execution state moves the experiment to `RECONCILIATION_REQUIRED`.

`evaluateAndCloseDurableExperiment()` evaluates the recovered approved experiment and performs the close as one authoritative state transition only when the deterministic evaluation is no longer `CONTINUE`.

## Evidence privacy

Experiment runtime records contain the full approved hypothesis because it is part of the authority being preserved. Compact lifecycle events do not repeat the hypothesis or campaign copy. They retain IDs, hashes, state, decision, and evidence references needed for audit/recovery.

## Restart behavior

After restart, GrowthOS reloads the exact durable experiment. It must not reconstruct a fresh experiment from the current prompt, campaign, or model context. Closed, stopped, inconclusive, or reconciliation-required state remains durable.

## Remaining production proof

This repository layer still depends on the runtime release gates in `docs/RUNTIME_PERSISTENCE.md`: real PostgreSQL transactions, migrations, restart/recovery drills, and backup restoration evidence before unattended client execution.
