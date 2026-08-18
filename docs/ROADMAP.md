# GrowthOS Roadmap

## North Star

Build an autonomous growth operating system that continuously understands a service business, identifies the highest-value justified growth opportunities, executes within owner-defined authority, converts demand into customers, and learns from actual business outcomes.

## Current phase

**Phase 0 — architecture/control-plane foundation.**

Do not confuse a repository scaffold with production autonomy.

---

# Program A — Foundation and Authority

## A0 — Repository doctrine — IN PROGRESS

- [x] dedicated repository
- [x] vision
- [x] canonical agent contract
- [x] system architecture
- [x] system-boundary doctrine
- [x] autonomy/control-plane doctrine
- [x] safety doctrine
- [x] decision log
- [x] Wiserr integration contract
- [x] AI Studio integration contract
- [x] business-state read model
- [x] growth event/outcome ledger
- [ ] executable schemas for core objects
- [ ] deterministic action-policy evaluator
- [ ] baseline tests
- [ ] CI verification

Exit condition: agents can reason about the system without inventing authority, ownership, or autonomy semantics.

## A1 — Tenant/service authority contract

- [ ] exact Wiserr-issued tenant/service context schema
- [ ] authorization adapter interface
- [ ] reject arbitrary tenant switching
- [ ] correlation/audit context
- [ ] authority-version/freshness behavior
- [ ] tests for cross-tenant denial

Exit condition: GrowthOS cannot execute or read tenant state without validated delegated authority.

## A2 — Action Envelope control plane

- [ ] canonical action request schema
- [ ] canonical envelope schema
- [ ] autonomy-level evaluation
- [ ] channel/account restrictions
- [ ] spend/resource ceilings
- [ ] offer/pricing authority
- [ ] capacity constraints
- [ ] validity/freshness
- [ ] approval binding
- [ ] revocation
- [ ] retry/attempt ceiling
- [ ] deterministic decision/audit reasons

Exit condition: the same action/policy input always produces the same authority decision.

---

# Program B — Business State and Opportunity Intelligence

## B0 — Growth read model

- [x] conceptual business-state read model
- [ ] concrete versioned schema
- [ ] Wiserr adapter
- [ ] snapshot persistence/reference
- [ ] completeness/freshness status
- [ ] aggregate-first privacy model

## B1 — Opportunity model

Initial opportunity families:
- dormant lead/customer reactivation
- unaccepted quote/estimate follow-up
- no-show/cancellation recovery
- review/referral opportunity
- local profile/reputation issue
- organic/content gap
- SEO/GEO gap
- paid acquisition opportunity
- conversion/follow-up leak
- capacity-constrained `NO_ACTION` / demand throttle

- [ ] canonical opportunity schema
- [ ] evidence references
- [ ] expected value/impact ranges
- [ ] uncertainty
- [ ] urgency
- [ ] operational feasibility
- [ ] required authority

## B2 — Chief Growth Strategist

- [ ] rank opportunities across departments
- [ ] avoid channel-first bias
- [ ] choose action portfolio based on business goals/capacity/economics
- [ ] explicitly support `NO_ACTION`
- [ ] explain evidence and uncertainty
- [ ] produce measurable plan/hypotheses

Exit condition: GrowthOS can recommend why one action outranks another, not merely generate a to-do list.

---

# Program C — First Vertical Slice: Owned-Demand Reactivation

This is the first end-to-end proof because it can close the business loop with lower external-platform complexity.

## C0 — Detect

- [ ] receive dormant-lead/customer aggregate from Wiserr
- [ ] identify eligible reactivation cohort
- [ ] evaluate suppression/communication eligibility
- [ ] estimate opportunity size
- [ ] create opportunity record

## C1 — Plan

- [ ] define campaign objective
- [ ] define audience/cohort
- [ ] define message/offer hypothesis
- [ ] define success metric
- [ ] define stop conditions/frequency
- [ ] produce action envelope
- [ ] request approval

## C2 — Execute

- [ ] resolve exact eligible recipients after approval
- [ ] deterministic outreach command
- [ ] idempotency/attempt records
- [ ] suppression/unsubscribe handling
- [ ] execution reconciliation

Initial channel should reuse an existing Wiserr-supported messaging path when possible rather than adding a new channel prematurely.

## C3 — Convert through Luna

- [ ] route replies to canonical Wiserr conversation authority
- [ ] Luna receives campaign/source context
- [ ] qualification/booking remains Wiserr-owned
- [ ] human takeover/escalation remains Wiserr-owned

## C4 — Close outcome loop

- [ ] ingest bookings
- [ ] ingest wins/completions/revenue-relevant outcomes
- [ ] attribution assessment
- [ ] campaign cost/time
- [ ] experiment close decision
- [ ] retained learning

Exit condition: one approved opportunity can move from business state → campaign → reply → appointment/sale → evidence-backed learning.

---

# Program D — Reputation / Local Growth

After the first closed loop:

- [ ] review-request opportunity detection
- [ ] eligible happy-customer cohort
- [ ] governed review request workflow
- [ ] review monitoring
- [ ] response drafting/execution policy
- [ ] Google Business Profile content/actions where API authority exists
- [ ] local profile completeness/health
- [ ] local attribution to calls/bookings where measurable

---

# Program E — Content / Distribution Integration

AI Studio is the creative department.

- [ ] GrowthOS creative-intent request schema
- [ ] consume approved AI Studio artifacts/provenance
- [ ] founder / real-client / synthetic-brand-character identity selection
- [ ] channel adaptation request
- [ ] content calendar as strategy output, not quota
- [ ] governed social distribution adapters
- [ ] publication verification
- [ ] comments/DM signal ingestion where justified
- [ ] content performance linked to business outcomes

Do not duplicate Content Farm, Character Intelligence, Viral Format Discovery, or provider rendering.

---

# Program F — SEO / GEO

- [ ] site/business search-state snapshot
- [ ] Search Console/analytics evidence where authorized
- [ ] local/service query opportunity model
- [ ] topic/page/content recommendation
- [ ] publish/update approval controls
- [ ] AI-search/GEO observation model
- [ ] ranking/traffic/lead learning

Do not automate large volumes of low-value pages merely because generation is cheap.

---

# Program G — Paid Acquisition

Paid media comes only after the control plane and outcome loop are proven.

## G0 — Account/capability adapters

- [ ] Meta Ads
- [ ] Google Ads
- [ ] current account/campaign/budget state
- [ ] permissions/capability detection
- [ ] exact external IDs

## G1 — Paid campaign envelope

- [ ] account/channel
- [ ] objective
- [ ] geography
- [ ] audience constraints
- [ ] approved creatives
- [ ] daily/total budget
- [ ] allowed optimization range
- [ ] stop conditions
- [ ] validity window

## G2 — Bounded optimization

- [ ] monitoring
- [ ] hard breach pause authority
- [ ] allocation shifts inside envelope
- [ ] creative refresh request
- [ ] no total-budget expansion without approval
- [ ] no uncontrolled retries/variants

## G3 — Revenue/quality learning

- [ ] qualified lead cost
- [ ] booked appointment cost
- [ ] won customer cost
- [ ] revenue/profit-relevant outcome where available
- [ ] distinguish channel attribution uncertainty

---

# Program H — Offer Strategy

- [ ] offer inventory
- [ ] economics/capacity constraints
- [ ] market/customer evidence
- [ ] offer hypotheses
- [ ] draft messaging
- [ ] owner approval for consequential changes
- [ ] experiment linkage
- [ ] result learning

GrowthOS must not autonomously create material discounts, guarantees, or pricing commitments without explicit authority.

---

# Program I — Autonomous Growth Department

Only after multiple departments have real evidence.

- [ ] Chief Growth Strategist coordinates opportunity portfolio
- [ ] specialist department contracts
- [ ] per-department tool/authority scopes
- [ ] real-time/daily/weekly/monthly/quarterly loops
- [ ] exception queue
- [ ] owner/Luna briefing
- [ ] account-level autonomy policy
- [ ] kill switches
- [ ] operator workload measurement

Target: recurring operational labor scales much slower than tenant count.

---

# Program J — Productization

Only after repeated real-client proof decide which UX/commercial forms become:
- native Wiserr Growth surfaces
- Luna capabilities
- managed autonomous agency
- premium GrowthOS add-on
- vertical GrowthOS packages
- standalone adapters for non-Wiserr systems

Do not build product packaging ahead of fulfillment evidence.

---

## Current execution order

1. Finish Phase A executable control-plane/schema/test scaffold.
2. Reconcile exact Wiserr integration contract against current Wiserr authorities.
3. Build the business-state snapshot adapter/read model.
4. Build dormant-lead/reactivation opportunity detection.
5. Build approval/action envelope lifecycle.
6. Execute the first owned-demand reactivation slice through existing Wiserr messaging/Luna authority.
7. Close booking/sale/outcome attribution.
8. Add reputation/local growth.
9. Connect AI Studio creative + distribution.
10. Only then expand toward SEO/GEO and bounded paid acquisition.

Do not fill idle development time by creating many agents or connectors without a closed outcome loop.
