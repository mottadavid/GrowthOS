# Wiserr ↔ GrowthOS Integration Contract

## Purpose

GrowthOS must consume canonical business context from Wiserr without becoming a competing operating system.

This document defines the conceptual boundary. Concrete API/event schemas will evolve with implementation.

## Trust model

Wiserr authenticates the tenant/user/service context. GrowthOS receives or derives an immutable execution context containing at minimum:

```text
tenantId
actorId / service principal
roles/scopes
authority version
request correlation ID
```

GrowthOS must not accept an arbitrary caller-supplied tenant ID as authority.

## Business State Read Model

GrowthOS needs a purpose-built growth read model rather than broad database access.

Initial categories:

### Business profile
- tenant/business ID
- industry/vertical
- service area / locations
- timezone
- languages
- operating hours
- products/services
- price/offer references where authorized

### Capacity/operations
- near-term availability/capacity signals
- backlog signals
- appointment/job availability
- operational constraints relevant to demand generation

### Customer/CRM
- contact/lead/customer references
- lifecycle stage
- source
- segmentation attributes explicitly permitted for growth use
- communication eligibility/suppression state
- last interaction / recency
- pipeline stage

### Outcomes
- booked appointments
- completed jobs/services
- won/lost opportunities
- revenue-relevant outcome references
- cancellation/no-show/retention signals where available

### Luna/conversation
- GrowthOS should not ingest unrestricted raw conversations by default.
- use scoped summaries/signals or explicit retrieval when necessary and authorized.

## Commands GrowthOS may request from Wiserr

GrowthOS should request actions rather than writing Wiserr-owned tables directly.

Examples:
- create/update growth-related CRM tag
- enroll eligible contacts into an approved outreach workflow
- request Luna follow-up/qualification
- create task/reminder for an operator
- record campaign/source attribution reference

Every command must be tenant scoped and permission checked by Wiserr.

## Events from Wiserr to GrowthOS

Potential event families:

```text
contact.created
lead.qualified
appointment.booked
appointment.cancelled
job.completed
opportunity.won
opportunity.lost
payment/recognized-revenue signal
capacity.changed
business-hours/availability changed
```

Do not add events merely for architectural completeness. Add when a GrowthOS decision genuinely requires them.

## GrowthOS events back to Wiserr

Examples:

```text
growth.opportunity.detected
growth.plan.approval_required
growth.action.executed
growth.action.failed
growth.campaign.started
growth.lead_source.attributed
growth.learning.recorded
```

Luna should eventually be able to summarize these to the owner naturally.

## Data freshness

Each read model/snapshot should expose:
- source timestamp
- snapshot/as-of timestamp
- optional version/hash
- completeness/coverage state when relevant

GrowthOS must not present stale operational state as current when freshness matters to execution.

## Failure semantics

Wiserr unavailable != growth hypothesis false.

Classify separately:
- authority/auth failure
- read-model unavailable
- stale data
- execution command failure
- ambiguous command outcome
- business/strategy decision

## Initial implementation preference

Begin with explicit HTTP/service contracts and event records that can later evolve to a queue/event bus. Do not introduce distributed-system complexity before the first end-to-end slice demonstrates the need.
