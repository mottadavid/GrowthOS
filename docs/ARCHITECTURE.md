# GrowthOS Architecture

## Architectural thesis

GrowthOS is a **governed multi-agent growth system** built around shared business context, explicit action authority, deterministic executors, and outcome learning.

The architecture separates four concerns:

1. **Truth** — what is actually happening in the business and market.
2. **Reasoning** — what opportunities/actions appear justified.
3. **Authority** — what the system is allowed to do.
4. **Execution** — deterministic connectors/workers that perform approved actions.

```text
TRUTH
  ↓
REASONING
  ↓
CONTROL PLANE
  ↓
EXECUTION
  ↓
OUTCOME
  ↓
LEARNING
```

An agent is never execution authority by itself.

## System topology

```text
┌─────────────────────────────────────────────────────┐
│ WISERR OS                                           │
│ canonical tenant + business + CRM + ops + Luna     │
└───────────────────────┬─────────────────────────────┘
                        │
              read models / events / commands
                        │
┌───────────────────────▼─────────────────────────────┐
│ GROWTHOS                                            │
│                                                     │
│  Business State Adapter                            │
│        ↓                                            │
│  Intelligence Layer                                │
│        ↓                                            │
│  Chief Growth Strategist                           │
│        ↓                                            │
│  Opportunity Portfolio                             │
│        ↓                                            │
│  Specialist Departments                            │
│        ↓                                            │
│  Marketing Control Plane                           │
│        ↓                                            │
│  Deterministic Executors                           │
│        ↓                                            │
│  Growth Event / Outcome Ledger                     │
│        ↓                                            │
│  Attribution + Learning                            │
└─────────────┬───────────────────────┬───────────────┘
              │                       │
              │ creative requests     │ channels/actions
              ↓                       ↓
┌────────────────────────┐   ┌─────────────────────────┐
│ WISERR AI STUDIO       │   │ External Systems       │
│ content/creative       │   │ Meta/Google/GBP/etc.   │
└────────────────────────┘   └─────────────────────────┘
```

## Planes

### 1. Truth Plane

Inputs include:
- Wiserr canonical business state
- marketing/channel state
- customer/lead behavior
- market/search/social/reputation observations
- previous GrowthOS actions and outcomes

GrowthOS may cache/derive read models but may not silently replace canonical authorities.

### 2. Intelligence Plane

Responsible for:
- opportunity detection
- prioritization
- strategy
- offer hypotheses
- channel/creative recommendations
- experiment design
- anomaly detection
- next-best-action reasoning

Outputs are proposals with evidence, confidence/uncertainty, expected impact, required authority, and measurable success conditions.

### 3. Control Plane

The deterministic authority boundary.

Checks include:
- tenant/user/service authority
- action-family autonomy level
- budget/spend envelope
- channel allowance
- geography/audience restrictions
- offer/pricing/discount authority
- brand/compliance constraints
- operational capacity
- approval state
- retry/rate limits
- execution freshness / stale-preflight protection

The control plane can return:
- `ALLOW`
- `REQUIRE_APPROVAL`
- `DENY`
- `NO_ACTION`

### 4. Execution Plane

Deterministic adapters/workers for approved actions.

Future examples:
- email/SMS/WhatsApp lifecycle actions
- Google Business Profile
- social publishing
- Google Ads
- Meta Ads
- CRM/Luna handoff
- review/referral requests
- SEO/GEO publishing
- AI Studio creative jobs

Executor failure does not automatically authorize retries.

### 5. Learning Plane

Connects:

```text
opportunity
→ hypothesis
→ strategy
→ action
→ creative
→ channel execution
→ audience signal
→ lead/customer progression
→ business outcome
→ cost/time
```

Learning must distinguish observed association from proven causality.

## Department model

Specialist departments should have narrow mandates and tool scopes.

Initial conceptual departments:

- Chief Growth Strategist
- Business/Customer Intelligence
- Market Intelligence
- Offer Strategy
- Owned Demand / Reactivation
- Content Planning
- Distribution
- Paid Acquisition
- Local Growth
- SEO / GEO
- Reputation
- Lifecycle
- Attribution
- Experiment Manager

Do not instantiate agents merely because the org chart names a department. A department becomes executable only when it has a demonstrated workflow, inputs, authority, outputs, and tests.

## Time horizons

GrowthOS must not optimize all decisions at the same cadence.

- **real time** — lead-response failures, spend breaches, channel outages, urgent anomalies
- **daily** — distribution, campaign health, ordinary engagement
- **weekly** — creative/channel performance, lead quality, experiment decisions
- **monthly** — offer/channel mix, capacity-aware growth plan, unit economics
- **quarterly** — ICP, positioning, strategic market shifts

## Data classes

### Canonical external truth
Owned by Wiserr or authoritative external systems.

### GrowthOS durable state
- goals
- opportunities
- strategies
- action envelopes
- approvals
- campaign references
- experiments
- growth events
- attribution links
- learning decisions

### Derived/cache state
Rebuildable read models and summaries.

### Secrets
Provider/channel credentials live in secret storage, never repository files or model-visible prompts unless strictly necessary.

## Reliability principle

An inability to execute or measure an experiment is not evidence that the underlying growth hypothesis is false.

Execution failures, missing permissions, capacity blockers, and measurement gaps must be classified separately from market/strategy verdicts.

## First vertical slice

The first proof should close a business outcome loop with minimal channel complexity:

```text
Wiserr business state
→ detect dormant lead/customer opportunity
→ recommend reactivation campaign
→ owner approval
→ deterministic message execution
→ Luna handles replies/qualification
→ appointments/sales from Wiserr
→ attribution
→ learning
```

This proves strategy, authority, execution, Luna integration, outcome ingestion, and learning before attempting broad autonomous media buying.
