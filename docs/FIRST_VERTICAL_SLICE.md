# First Vertical Slice — Dormant Demand Reactivation

## Why this is first

The first GrowthOS proof should demonstrate the complete architecture with the fewest new external dependencies.

Dormant lead/customer reactivation can prove:

```text
Wiserr business truth
→ opportunity detection
→ growth recommendation
→ action envelope
→ owner approval
→ deterministic execution
→ Luna conversation/qualification
→ booking/sale outcome
→ attribution
→ learning
```

without first building Meta Ads, Google Ads, social publishing, AI video generation, SEO crawling, or a large dashboard.

## Business problem

Service businesses frequently have value sitting inside existing demand:
- leads that stopped responding
- quotes/estimates not accepted
- past customers who are due to return
- cancellations/no-shows
- inquiries that were never followed up correctly

A world-class GrowthOS should check those assets before buying new traffic.

## Stage 1 — Snapshot

GrowthOS requests a purpose-built growth snapshot from Wiserr.

Minimum evidence for dormant-lead detection:
- tenant authority
- snapshot freshness/completeness
- dormant-lead aggregate
- current capacity/throttle state
- applicable customer-contact suppression/eligibility capabilities

Do not pull the full recipient list yet.

## Stage 2 — Opportunity

Current initial primitive: `evaluateDormantLeadReactivation()`.

It may return:
- `OPPORTUNITY`
- `NO_ACTION`
- `INSUFFICIENT_EVIDENCE`

This is deliberate. A large dormant cohort does not justify action if the business is full or the state is stale.

## Stage 3 — Plan

The planner should produce:

```text
opportunityId
objective
cohort definition
message/offer hypothesis
channel
success metric
experiment horizon
frequency/stop rules
estimated recipient count
estimated cost
required action envelope
```

Initial default should require owner approval (`L3_APPROVAL_REQUIRED`).

## Stage 4 — Exact recipient resolution

Only after plan/envelope approval should GrowthOS request the exact eligible recipient set from Wiserr.

Wiserr remains authority for:
- contact identity
- contact eligibility
- opt-out/suppression
- lifecycle state
- tenant isolation

The exact recipient count must be rechecked against the envelope before send.

## Stage 5 — Execution

Prefer an existing Wiserr messaging capability for the first slice.

Execution requirements:
- stable campaign/action ID
- recipient idempotency where possible
- attempt ceiling
- send status
- ambiguous outcome classification
- suppression/unsubscribe behavior
- correlation/source metadata for future Luna replies

Do not create a new outbound messaging stack in GrowthOS if Wiserr already has the authority/capability.

## Stage 6 — Luna conversion

Replies enter Wiserr's canonical conversation layer.

Luna should receive context such as:
- GrowthOS campaign ID
- campaign objective
- offer/message context
- original cohort reason

Luna handles qualification/booking within Wiserr authority. Human takeover remains Wiserr-owned.

## Stage 7 — Outcomes

GrowthOS consumes authoritative outcome signals from Wiserr:
- reply
- qualified lead
- appointment booked
- appointment attended where available
- opportunity won / job completed
- revenue-relevant outcome

## Stage 8 — Attribution

Initial attribution may be simple/direct when an outcome is clearly linked to the campaign conversation.

Record confidence. Do not force all outcomes into direct attribution.

## Stage 9 — Learning

Close the experiment with:
- cohort size
- delivery/sends
- responses
- qualified responses
- bookings
- sales/revenue outcomes where available
- cost
- human/operator time
- attribution confidence
- unexpected operational issues
- decision: retain / modify / stop / insufficient evidence

The next campaign should be able to cite this evidence.

## Non-goals for first slice

Do not add yet:
- general marketing dashboard
- Meta Ads
- Google Ads
- AI Studio video dependency
- social scheduling
- SEO/GEO
- many specialist agents
- automatic offer creation

The slice succeeds only when the business outcome loop is closed and auditable.
