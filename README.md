# GrowthOS

GrowthOS is the autonomous growth operating system for service businesses.

It is designed to continuously understand a business, identify the highest-value justified growth opportunities, execute approved actions across growth channels, convert demand into customers through Wiserr/Luna, measure real business outcomes, and learn what to do next.

GrowthOS is **strategically part of Wiserr** but **technically isolated as its own service/repository** while the operating model is being proven.

> **Status:** architecture + executable control-plane foundation. Not yet a production autonomous marketing platform.

## North Star

> Build an autonomous growth operating system that continuously understands a business, identifies the highest-value growth opportunities, executes within owner-defined authority, converts demand into customers, and learns from actual business outcomes.

GrowthOS is not designed to maximize marketing activity. It should be able to decide that the correct action is:

- reactivate dormant demand
- fix conversion/follow-up
- request reviews/referrals
- improve local presence
- create/publish content
- pursue SEO/GEO
- test paid acquisition
- improve an offer
- reduce acquisition because fulfillment capacity is constrained
- **do nothing yet because evidence is insufficient**

## Product topology

```text
Wiserr OS
canonical tenant + business truth + CRM + operations + Luna
        ↓
GrowthOS
strategy + opportunities + control plane + growth execution + attribution
        ↓
AI Studio
Content Farm + Brand Character Intelligence + Viral Format Discovery + creative production
```

### Wiserr owns

- tenant identity and permission authority
- contacts/customers/leads
- conversations/inbox
- appointments/jobs
- CRM/pipeline
- business operational state/capacity
- Luna
- canonical business outcomes

### GrowthOS owns

- growth goals
- opportunity intelligence
- growth strategy/action portfolio
- offers under analysis/review
- marketing action envelopes/approvals
- distribution orchestration
- paid media orchestration
- local/SEO/GEO/reputation/lifecycle growth workflows
- experiments
- attribution
- growth learning

### AI Studio owns

- Human Content Farm
- Brand Character Intelligence
- Viral Format Discovery
- identity/voice/video production
- creative QC and creative provenance

GrowthOS requests creative intent. It does not duplicate the creative factory.

## Core architecture

```text
BUSINESS + MARKET TRUTH
        ↓
GROWTH INTELLIGENCE
        ↓
CHIEF GROWTH STRATEGIST
        ↓
PRIORITIZED OPPORTUNITY
        ↓
SPECIALIST WORKFLOW / DEPARTMENT
        ↓
DETERMINISTIC MARKETING CONTROL PLANE
        ↓
EXECUTOR
        ↓
AUDIENCE / LEAD / CUSTOMER RESPONSE
        ↓
WISERR / LUNA / BUSINESS OUTCOME
        ↓
ATTRIBUTION + LEARNING
        ↓
NEXT BEST ACTION
```

## Autonomous agency doctrine

GrowthOS is not one giant agent.

Long-term departments include:

1. Business & Customer Intelligence
2. Market Intelligence
3. Chief Growth Strategist
4. Offer Strategy
5. Owned Demand / Reactivation
6. Content & Creative Planning
7. Distribution
8. Paid Acquisition
9. Local Growth / Google Business Profile
10. SEO / GEO
11. Reputation / Reviews / Referrals
12. Lifecycle / CRM Marketing
13. Lead Conversion coordination with Luna
14. Attribution & Measurement
15. Experiment & Learning Management

Departments become executable only after their workflow, evidence, authority, and evaluation contract is proven.

## Deterministic autonomy

Agents reason and propose. Deterministic policy authorizes execution.

Autonomy levels:

- `L0_OBSERVE`
- `L1_RECOMMEND`
- `L2_DRAFT`
- `L3_APPROVAL_REQUIRED`
- `L4_BOUNDED_AUTONOMOUS`
- `L5_LOW_RISK_AUTONOMOUS`

A campaign can be autonomous **inside** an approved envelope without granting the agent permission to expand that envelope.

Example:

```text
Meta account X
objective: leads
geography: Tampa
approved creatives: A/B/C
max $50/day
max $500 total
max ±20% allocation movement
no offer/price changes
```

GrowthOS may optimize inside the envelope. Increasing the total budget requires new authority.

## Already implemented in this foundation

- canonical vision/architecture/boundaries
- Wiserr integration contract
- AI Studio integration contract
- business-state read model
- growth event/outcome ledger
- autonomy/control-plane doctrine
- safety doctrine
- versioned action/business/opportunity/event schemas
- deterministic action-policy evaluator
- tenant/action/channel/account/geography/attempt/budget/recipient enforcement
- capacity-aware `NO_ACTION`
- approval escalation for consequential business changes
- first dormant-lead reactivation opportunity detector
- automated tests
- GitHub Actions verification

## First vertical slice

The first proof is **owned-demand reactivation**:

```text
Wiserr business state
→ dormant demand opportunity
→ owner-approved campaign envelope
→ outreach through existing Wiserr capability
→ Luna handles replies/qualification
→ appointment/sale outcome
→ GrowthOS attribution + learning
```

This closes the business-outcome loop before adding broad ad/social/SEO automation.

See `docs/FIRST_VERTICAL_SLICE.md`.

## Documentation map

- `AGENTS.md` — mandatory agent operating contract
- `docs/VISION.md` — north star and long-term product thesis
- `docs/ARCHITECTURE.md` — system topology and planes
- `docs/SYSTEM_BOUNDARIES.md` — authority ownership across Wiserr/GrowthOS/AI Studio
- `docs/WORLD_CLASS_AGENCY_BLUEPRINT.md` — autonomous agency departments and operating model
- `docs/AUTONOMY_CONTROL_PLANE.md` — autonomy levels and deterministic execution authority
- `docs/BUSINESS_STATE_READ_MODEL.md` — bounded business context GrowthOS consumes
- `docs/WISERR_INTEGRATION_CONTRACT.md` — Wiserr boundary
- `docs/AI_STUDIO_INTEGRATION_CONTRACT.md` — creative boundary
- `docs/GROWTH_EVENT_LEDGER.md` — decision/execution/outcome evidence chain
- `docs/FIRST_VERTICAL_SLICE.md` — first end-to-end proof
- `docs/ROADMAP.md` — full execution roadmap
- `docs/SAFETY.md` — non-negotiable safeguards
- `docs/DECISIONS.md` — durable architectural decisions

## Development

Requires Node 24+.

```bash
npm run verify
```

The current core intentionally has zero runtime dependencies.

## Productization doctrine

Do not build a generic standalone SaaS UI merely because this is a separate repository.

The intended product front door is primarily Wiserr/Luna. Whether GrowthOS is ultimately sold as a Wiserr module, add-on, managed autonomous agency, vertical package, standalone service, or several of those forms should be decided from real-client evidence rather than architecture alone.
