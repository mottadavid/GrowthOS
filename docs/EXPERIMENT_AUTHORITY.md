# Experiment Authority

GrowthOS should not create variants simply because generation is cheap. A meaningful growth experiment needs a stated hypothesis, bounded exposure, a predeclared success metric, guardrails, an observation horizon, and evidence-backed closure.

## V1 purpose

The first experiment authority is intentionally a **single-action hypothesis test**, not a generalized A/B statistics engine.

It answers:

> Did this approved growth action meet the predeclared business criterion within its approved exposure/spend envelope, without tripping safety guardrails?

Comparative testing, incrementality, Bayesian allocation, multi-armed bandits, and causal lift models are later authorities. They must not be implied by this V1 contract.

## Required chain

```text
business snapshot
→ opportunity
→ exact approved action plan
→ experiment hypothesis
→ external experiment approval authority
→ bounded execution
→ growth/outcome events
→ evidence-backed observation
→ deterministic experiment close
→ retained learning
```

## Approval

Experiment approval binds the exact:

- opportunity and business snapshot
- hypothesis
- action-plan reference and hash
- primary metric
- success criterion
- guardrails
- minimum sample size
- observation horizon
- maximum exposure
- maximum spend

Changing any of those values after approval invalidates the approval hash.

The approval record stores an external `approvalAuthorityRef`. GrowthOS does not decide whether the actor is an owner/admin by itself.

## No early success claims

GrowthOS does not declare success merely because early numbers look favorable.

Until both are satisfied:

1. `minimumSampleSize`
2. `observationHorizonHours`

normal evaluation returns `CONTINUE`.

This is not a statistical-significance claim. It is a deterministic anti-peeking rule defined by the approved experiment.

## Early stop guardrails

Guardrails can stop an experiment before the normal observation horizon.

Examples may include:

- spend ceiling
- exposure ceiling
- opt-out rate
- complaint rate
- other explicitly declared business-safety metrics

GrowthOS does not invent guardrails during execution.

## Evidence requirement

Every observation used for evaluation carries one or more `evidenceRefs` pointing to retained GrowthOS/Wiserr outcome evidence.

An experiment may not close from unattached dashboard numbers or model-generated estimates.

## Closure decisions

- `SUCCESS` — predeclared primary criterion met after minimum evidence.
- `FAILURE` — predeclared criterion not met after minimum evidence.
- `INCONCLUSIVE` — minimum evidence window reached but the primary metric is unavailable/unusable.
- `STOP_GUARDRAIL` — a declared guardrail, spend limit, or exposure limit was breached.
- `CONTINUE` — normal observation should continue.

## Reconciliation

If execution/result evidence is ambiguous, the experiment enters `RECONCILIATION_REQUIRED` rather than closing on uncertain data.

## What this does not prove

A successful experiment does not automatically prove causal incrementality.

The growth-outcome ledger's attribution confidence remains authoritative. Experiment success means the predeclared observed criterion was satisfied, not that GrowthOS has mathematically proven the action caused the entire outcome.
