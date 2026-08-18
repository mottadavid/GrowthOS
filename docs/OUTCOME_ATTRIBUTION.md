# Outcome Attribution Doctrine

## Purpose

GrowthOS should optimize toward real business outcomes without overstating causal certainty.

Execution certainty and attribution confidence are different dimensions.

Example:

```text
SMS provider acceptance: CONFIRMED
Booking attribution to campaign: MEDIUM
```

A confirmed send does not prove the send caused a booking or sale.

## Event chain

```text
business snapshot
→ opportunity
→ strategy/action
→ policy decision
→ execution attempt
→ external acceptance/result
→ customer signal
→ lead progression
→ booking/sale outcome
→ attribution assessment
→ retained learning
```

Each event carries tenant and correlation identity so traces can be reconstructed without mixing tenants or campaigns.

## Attribution confidence

- `DIRECT` — canonical business outcome retains an explicit campaign/action correlation and supporting evidence.
- `HIGH` — strong evidence with limited plausible competing explanations, but no direct canonical correlation.
- `MEDIUM` — temporally and contextually consistent association with meaningful uncertainty.
- `LOW` — weak association; useful only as context, not proof.
- `UNATTRIBUTED` — outcome is known but cannot responsibly be linked to the growth action.
- `NOT_APPLICABLE` — event is not an attribution-bearing outcome.

## Direct attribution gate

GrowthOS may not label an outcome `DIRECT` merely because it occurred after a campaign.

`DIRECT` requires:

1. a canonical Wiserr outcome ID;
2. a direct retained correlation ID;
3. explicit evidence describing the correlation.

## Learning rule

GrowthOS may learn from uncertainty, but confidence must travel with the evidence.

Do not collapse:

- correlation into causation;
- platform conversions into canonical sales automatically;
- engagement metrics into revenue;
- one successful experiment into a universal rule.

## Multi-touch future

The first implementation deliberately avoids pretending to solve full causal multi-touch attribution.

Later models may incorporate:

- observation windows
- competing known touches
- holdouts
- incrementality tests
- platform conversion evidence
- first/last-touch views
- statistical models

Those should be added only when the data supports them and should remain distinguishable from canonical business outcomes.
