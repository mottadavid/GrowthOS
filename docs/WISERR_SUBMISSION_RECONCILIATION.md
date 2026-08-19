# Wiserr Submission Reconciliation

## Purpose

An ambiguous external submission may leave both the execution attempt and campaign in `RECONCILIATION_REQUIRED`. Resolution must update both durable state machines without creating another attempt or contacting Wiserr again.

`reconcileWiserrReactivationSubmissionAndCampaign()` is the only coordination layer for this first-loop reconciliation.

## Allowed outcomes

```text
COMPLETED
→ attempt RECONCILED_COMPLETED
→ campaign OBSERVING

FAILED
→ attempt RECONCILED_FAILED
→ campaign FAILED

NOT_ACCEPTED
→ attempt RECONCILED_FAILED
→ campaign FAILED
```

`NOT_ACCEPTED` remains distinguishable in the retained attempt reconciliation evidence even though both failure resolutions terminate the current campaign.

## Authority and evidence

A reconciliation requires:

- execution-enabled tenant runtime;
- exact tenant/campaign/attempt identity;
- explicit reconciliation actor (`by`);
- retained external evidence reference;
- one of the three allowed deterministic outcomes.

The coordinator never guesses the outcome from a timeout or error string.

## Crash recovery

Attempt reconciliation and campaign reconciliation are separate durable transitions by design.

If the process crashes after the attempt becomes reconciled but before the campaign transition:

1. replay loads the already-reconciled attempt;
2. exact outcome/actor/evidence must match the retained reconciliation;
3. only the missing campaign transition is applied.

Changed evidence or changed reconciliation semantics fail closed.

## Campaign lifecycle

A completed reconciliation uses the explicit transition:

`RECONCILIATION_REQUIRED → OBSERVING`

This is intentionally separate from the ordinary `EXECUTING → OBSERVING` transition. Historical reconciliation evidence therefore remains semantically visible rather than being disguised as an ordinary successful execution path.

Failed reconciliation uses the existing:

`RECONCILIATION_REQUIRED → FAILED`

## No retry authority

This layer cannot:

- create another execution attempt;
- resubmit the persisted command;
- contact Wiserr;
- reopen a failed campaign;
- reinterpret ambiguous evidence autonomously.

Any future retry requires a separately authorized action and must satisfy the normal attempt, campaign, policy, capacity, communication, and approval controls.
