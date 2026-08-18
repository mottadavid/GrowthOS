# Growth Event and Outcome Ledger

## Purpose

GrowthOS must preserve the chain from decision to business outcome so that learning is based on evidence rather than memory or dashboards.

## Event chain

```text
business snapshot
→ opportunity
→ strategy/plan
→ action proposal
→ policy decision / approval
→ execution attempt
→ external execution reference
→ audience/customer signal
→ lead/customer progression
→ business outcome
→ attribution assessment
→ learning decision
```

## Core event families

### Intelligence
- `growth.snapshot.observed`
- `growth.opportunity.detected`
- `growth.opportunity.dismissed`
- `growth.plan.created`
- `growth.no_action.decided`

### Governance
- `growth.action.preflighted`
- `growth.action.approval_requested`
- `growth.action.approved`
- `growth.action.denied`
- `growth.envelope.created`
- `growth.envelope.revoked`

### Execution
- `growth.action.attempt_started`
- `growth.action.accepted_external`
- `growth.action.completed`
- `growth.action.failed_definitive`
- `growth.action.reconciliation_required`
- `growth.action.reconciled`

### Response
- `growth.response.observed`
- `growth.lead.created`
- `growth.lead.qualified`
- `growth.appointment.booked`
- `growth.sale.observed`
- `growth.revenue.observed`

Business outcome events generally originate from Wiserr and are linked into GrowthOS rather than invented locally.

### Learning
- `growth.attribution.assessed`
- `growth.experiment.closed`
- `growth.learning.recorded`

## Required event metadata

Every GrowthOS event should include:

```text
eventId
schemaVersion
eventType
tenantId
occurredAt
recordedAt
correlationId
causationId (when applicable)
sourceSystem
actor/service
payload
```

Significant events should reference immutable IDs/versions for:
- business snapshot
- opportunity
- action
- policy/envelope
- approval
- experiment
- external platform object

## Outcome certainty

Do not flatten all outcomes into success/failure.

Execution certainty:
- `CONFIRMED`
- `DEFINITIVE_FAILURE`
- `AMBIGUOUS`

Attribution confidence:
- `DIRECT`
- `HIGH`
- `MEDIUM`
- `LOW`
- `UNATTRIBUTED`

These dimensions are different.

## Causal caution

An action preceding a sale does not prove it caused the sale.

Learning records should state:
- evidence available
- attribution method
- sample size
- confidence/limitations
- decision taken

## Retention

The ledger is an audit/learning authority. Do not overwrite historical events to make the current strategy look cleaner. Corrections append new events referencing the prior event.
