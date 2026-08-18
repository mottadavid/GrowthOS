# Business State Read Model

GrowthOS must reason from a bounded, reproducible view of the business rather than unrestricted database access.

## Goals

The read model should answer enough to decide:
- what growth is needed
- what growth is safe to pursue
- which customer segments are eligible
- what the business can fulfill
- what happened after prior actions

## Snapshot shape

Every snapshot should include:

```text
snapshotId
schemaVersion
tenantId
sourceSystem
sourceVersion / sourceCursor where available
asOf
completeness state
```

## Business profile

- business/tenant ID
- vertical/industry
- locations/service areas
- timezone
- languages
- business hours
- services/products
- approved pricing/offer references
- strategic goals

## Capacity state

Keep this operationally meaningful rather than pretending to model every business detail.

Examples:
- appointment availability
- staff/provider capacity
- estimate/job backlog
- service/product constraints
- seasonal/temporary constraints
- demand throttle recommendation when supplied by Wiserr

## Customer/lead aggregates

Prefer privacy-preserving aggregates for strategy when row-level data is unnecessary.

Examples:
- leads by lifecycle stage
- dormant leads by recency bucket
- customers by recency/frequency/value buckets
- unaccepted estimates/quotes
- no-show/cancel cohorts
- inactive customers
- review-eligible customer count

Row-level recipient sets should be requested only when an approved action needs execution.

## Funnel state

- traffic/source summary when available
- inquiries
- qualified leads
- booked appointments
- attended appointments
- opportunities/estimates
- won/completed
- revenue outcome references

## Marketing state

- currently active campaigns/channels
- approved budgets
- recent spend
- active offers
- recent content/publishing cadence
- major channel health warnings

## Reputation/local state

- review count/rating trend where available
- review request eligibility
- local profile health signals
- unresolved public reputation issues requiring human attention

## Historical outcome state

For prior GrowthOS actions expose:
- action IDs
- audience/cohort
- costs
- observed responses
- bookings/sales/revenue references
- attribution confidence

## Completeness

A snapshot can be:
- `COMPLETE_FOR_PURPOSE`
- `PARTIAL`
- `STALE`
- `UNAVAILABLE`

GrowthOS must propagate this uncertainty into recommendations.

## Reproducibility

Every significant opportunity/strategy should retain the `snapshotId` used to make the decision. Later learning should be able to distinguish changed business state from changed reasoning.
