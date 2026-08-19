# GrowthOS / Autonomous Agency — Complete New-Chat Handoff

**As of:** 2026-08-19 evening ET  
**Primary repo:** `mottadavid/GrowthOS`  
**GrowthOS main observed during handoff audit:** `a243d003cfc762e7c8badd5cabf61276dd6494e6`  
**Related repos:** `mottadavid/Wiserr-OS` and `mottadavid/wiserr-ai-studio`

> **Important:** This project is being developed while many other Wiserr branches/PRs merge concurrently. Do not trust a branch, PR, SHA, roadmap checkbox, or this handoff blindly. At the beginning of a new chat/work session, re-read current `main`, current open PRs, GitHub Issue #1, and the canonical docs. Treat this handoff as the product/architecture/continuity document, not as permission to stale-merge code.

---

# 0. NEW CHAT START PROMPT

Paste the following into a fresh chat if needed:

> We are continuing the GrowthOS / autonomous agency project. You are acting as CTO/lead product architect and must work from repository truth, not chat assumptions. First read `mottadavid/GrowthOS` current `main`, `README.md`, `AGENTS.md`, `docs/FULL_HANDOFF_2026-08-19.md`, GitHub Issue #1, `docs/WORLD_CLASS_AGENCY_BLUEPRINT.md`, `docs/ARCHITECTURE.md`, `docs/SYSTEM_BOUNDARIES.md`, `docs/AUTONOMY_CONTROL_PLANE.md`, `docs/SAFETY.md`, `docs/RUNTIME_PERSISTENCE.md`, and the current code/tests. Then inspect relevant current `mottadavid/Wiserr-OS` and `mottadavid/wiserr-ai-studio` authorities before changing cross-repo contracts. Many Wiserr PRs merge concurrently, so never merge a stale-base PR merely because its CI was green. Revalidate the exact current base/merge ref. Continue the highest-value next slice toward one real closed revenue loop. Do not invent capacity, messaging authority, consent, attribution, provider capability, or production readiness. Preserve fail-closed authority, exact approvals, bounded autonomy, durable evidence, no blind retries, and `NO_ACTION` when intervention is not justified. Do not expand into Meta/Google/social/SEO agents until the first revenue loop is proven unless current repo evidence changes the priority.

---

# 1. WHY THIS PROJECT EXISTS

The immediate business context was a managed marketing service for service businesses, beginning with **CKO Accounting Services / Cristiane**. The initial commercial agreement discussed was approximately **$1,200/month**, lower than the desired agency price, accepted as a Client Zero/proof opportunity with a potential Wiserr referral/channel relationship.

The core business problem:

- service businesses repeatedly say they need more business;
- many have been burned by agencies and are reluctant to pay for ads or additional marketing spend;
- if a managed service cannot show outcomes quickly enough, clients churn;
- David needs the service to be highly streamlined because the goal is to fund continued Wiserr development without creating another labor-heavy agency;
- the managed service therefore needs to deliver outcomes using the management fee first, with paid media as a secondary lever unless the client explicitly wants it or evidence makes it the best action.

The original non-paid priority stack included:

- database reactivation;
- organic/social growth;
- content;
- reviews/referrals;
- local SEO / GEO / discoverability;
- conversion/follow-up;
- email/SMS/lifecycle work;
- offer improvement;
- paid acquisition later or when justified.

The insight that changed the project was that the goal should not be “automate an agency task list.” The stronger goal is:

> **Continuously decide and execute the next best justified action to grow the business.**

Sometimes that action is content. Sometimes it is reactivation. Sometimes it is reviews. Sometimes it is ads. Sometimes it is fixing conversion. Sometimes the correct decision is **NO_ACTION** because evidence is weak or the business cannot fulfill more demand.

---

# 2. NORTH STAR

Build a **world-class autonomous growth operating system for service businesses** that:

1. continuously understands the business;
2. understands customers, pipeline, capacity, economics, and outcomes;
3. observes relevant market/customer/channel evidence;
4. identifies the highest-value justified growth opportunities;
5. proposes or executes actions within explicit owner-defined authority;
6. uses deterministic software to enforce policy, budget, tenant, consent, capacity, and retry boundaries;
7. converts demand through Wiserr/Luna rather than stopping at lead generation;
8. attributes outcomes conservatively;
9. learns from real bookings/sales/revenue rather than vanity metrics;
10. reduces recurring human labor without reducing quality or control.

The target is not maximal autonomy. The target is:

```text
senior human strategy / exception judgment
        +
governed autonomous recurring execution
        +
closed-loop business outcome learning
```

A mature account may eventually automate a very high percentage of recurring labor, while consequential judgment remains governed.

---

# 3. PRODUCT / REPOSITORY BOUNDARIES

## 3.1 Wiserr OS owns canonical business truth

Wiserr remains authority for:

- tenants, users, roles, permissions;
- contacts, customers, leads;
- CRM/pipeline;
- conversations/inbox;
- Luna;
- appointments/jobs;
- operational business state/capacity authorities;
- communication suppression/opt-outs;
- canonical messaging execution;
- booking/sale/business outcomes;
- tenant-facing operating experience.

GrowthOS must **not** create a competing CRM, permission system, messaging stack, or booking authority.

## 3.2 GrowthOS owns growth intelligence and governed orchestration

GrowthOS owns:

- growth goals;
- opportunity detection;
- opportunity ranking;
- growth strategy/action portfolios;
- offer hypotheses;
- action envelopes/autonomy;
- campaign orchestration;
- distribution orchestration;
- paid-media strategy/control later;
- reputation/local/SEO-GEO/lifecycle strategy later;
- experiments;
- attribution;
- growth learning;
- marketing control plane.

## 3.3 AI Studio owns creative intelligence + production

`mottadavid/wiserr-ai-studio` is the creative department. It owns:

- Human Content Farm;
- Brand Character Intelligence;
- Viral Format Discovery;
- Identity Profiles;
- human/synthetic/licensed identity provenance;
- voice/avatar/video/image/text creative production;
- provider orchestration;
- creative QC;
- creative economics/provenance.

GrowthOS should ask **why / what / where** creative is needed. AI Studio decides **how** to safely create it.

## 3.4 UX vs technical architecture

Strategically GrowthOS is part of Wiserr. Technically it is a separate service/repository while the model is being proven. The eventual user experience can primarily live inside Wiserr/Luna even if the engine remains a separate service.

This preserves optionality for a managed agency, a Wiserr add-on, vertical packages, or a standalone GrowthOS later.

---

# 4. THE WORLD-CLASS AUTONOMOUS AGENCY BLUEPRINT

GrowthOS should eventually operate like departments, not one giant free-running agent.

## Department 1 — Business & Customer Intelligence

Continuously understands:

- services/products;
- prices/economics/margins where available;
- goals;
- capacity;
- seasonality;
- customers/leads;
- pipeline;
- conversion history;
- reviews/feedback;
- channel/campaign history.

Output: current business state, completeness/freshness, meaningful changes.

## Department 2 — Market Intelligence

Evidence may include:

- search demand;
- competitor positioning;
- local market movement;
- reviews/reputation;
- content/platform patterns;
- offer/category movement;
- relevant trend evidence.

Output: sourced opportunities/threats with freshness and uncertainty.

## Department 3 — Chief Growth Strategist

Core question:

> Given goals, business state, market state, constraints, capacity, economics, and prior evidence, what is the highest-value justified action now?

It must rank across departments rather than default to content or ads.

Valid answers include:

- reactivate dormant demand;
- fix follow-up/conversion;
- request reviews/referrals;
- repair local presence;
- create content;
- improve SEO/GEO;
- test paid acquisition;
- change an offer;
- reduce acquisition due to capacity;
- **NO_ACTION**.

## Department 4 — Offer Strategy

Analyzes audience pain, urgency, service economics, proof, competition, capacity, price/risk reversal, and CTA. Agents may draft hypotheses; consequential pricing/discount/guarantee changes require explicit authority.

## Department 5 — Content & Creative

Delegated to AI Studio. Inputs from GrowthOS include campaign objective, audience, channel, content intent, and preferred identity class. AI Studio handles source truth, format, identity, production, QC, and creative provenance.

## Department 6 — Distribution

Eventually:

```text
approved artifact
→ channel adaptation
→ metadata/schedule
→ publish/send
→ verify external ID
→ capture failure
→ measure
```

Potential channels: social, email, messaging, GBP, web/CMS, etc., only where current API/policy authority exists.

## Department 7 — Paid Acquisition

Later, only after control plane and outcome loop are proven. Never unconstrained budget authority. Typical envelope includes account, objective, geography, audience, creatives, daily/total budget, allowed optimization movement, stop conditions, and validity window.

## Department 8 — Lead Conversion / Lifecycle

GrowthOS coordinates intent. Wiserr/Luna remains conversation/execution authority:

```text
lead/customer signal
→ immediate response
→ qualification
→ booking
→ reminder/follow-up
→ won/lost outcome
```

This is a major structural advantage over a conventional agency that stops at “lead generated.”

## Department 9 — Attribution / Experiment / Learning

Evidence chain can include:

```text
source/story
format/hook
identity
creative
channel
spend
impressions/views
retention/engagement
click/message
lead
qualified lead
booking
sale
revenue outcome
human/provider cost
```

The system learns from business outcomes, not production volume.

---

# 5. STRATEGY HORIZONS

GrowthOS should eventually reason on multiple horizons so it does not overreact to noise.

**Real-time:** hard policy/spend breaches, lead-response failures, severe platform/reputation incidents.  
**Daily:** execution health, campaign health, ordinary distribution/community exceptions.  
**Weekly:** creative performance, lead quality, experiments, bounded reallocation.  
**Monthly:** offer/channel mix, capacity-aware growth plan, unit economics, content strategy.  
**Quarterly:** ICP, positioning, market shifts, major growth priorities.

---

# 6. AUTONOMY DOCTRINE

There is no global `autonomous=true`.

Autonomy levels:

```text
L0 OBSERVE
L1 RECOMMEND
L2 DRAFT
L3 APPROVAL_REQUIRED
L4 BOUNDED_AUTONOMOUS
L5 LOW_RISK_AUTONOMOUS
```

L5 is not “more power” than L4; allowed autonomy levels are explicit sets, not a numeric maximum.

Examples:

- analyze metrics: autonomous;
- generate ideas: autonomous;
- draft content: autonomous;
- publish pre-approved scheduled content: potentially bounded autonomous;
- ordinary review response: potentially bounded autonomous;
- lead follow-up: potentially bounded autonomous under communication authority;
- launch new paid test: approval;
- change offer/pricing: approval;
- increase total budget: approval;
- make consequential guarantees: approval.

## Core rule

> **Intelligence proposes. Deterministic policy decides whether execution is permitted.**

The control plane validates tenant, delegate, action family, channel/account/geography, spend, recipients, attempts, capacity, freshness, approvals, validity windows, and consequential changes.

Possible decisions:

```text
ALLOW
REQUIRE_APPROVAL
DENY
NO_ACTION
```

---

# 7. NON-NEGOTIABLE SAFETY / RELIABILITY DOCTRINE

1. **Tenant isolation is load-bearing.** Never trust caller-selected tenant identity when canonical authority exists.
2. **No invented authority.** Transport existence is not permission to use it.
3. **No invented capacity.** `authoritative: true` is not sufficient; the source itself needs current authority.
4. **No blind retry after ambiguous external side effects.** Unknown provider/channel outcome becomes reconciliation work.
5. **Approval binds the exact consequential action.** Post-approval mutation invalidates authority.
6. **Historical authority is immutable evidence.** Later revocation must not rewrite what was valid at execution time.
7. **Read authority, capacity authority, communication authority, autonomy authority, policy approval, execution certainty, and outcome attribution are separate concepts.**
8. **Fail toward less autonomy.** Replacement/crash paths should temporarily reduce authority, not widen it.
9. **Process startup is read-only by default.** Healthy infrastructure is not execution authority.
10. **`NO_ACTION` is a valid high-quality outcome.** The system must know when not to intervene.
11. **Do not optimize vanity metrics as if they were revenue.**
12. **Do not call correlation causation.** DIRECT attribution requires canonical outcome + direct correlation + evidence.
13. **No private campaign content in compact audit events where hashes/IDs suffice.**
14. **Cross-repo authority is evidence-driven.** OBSERVED/CANDIDATE/CERTIFIED/REVOKED receipts + semantic fingerprints.
15. **Never stale-merge a cross-repo PR simply because old-base CI passed.** Re-check current base/merge ref.

---

# 8. FIRST VERTICAL SLICE — OWNED-DEMAND REACTIVATION

This was deliberately selected before ads/social/SEO because it can prove the complete business loop with lower platform complexity and can produce value from existing business assets without requiring ad spend.

Target loop:

```text
canonical Wiserr business state
        ↓
dormant demand detected
        ↓
GrowthOS opportunity
        ↓
campaign hypothesis
        ↓
action envelope + exact approval
        ↓
current capacity proof
        ↓
current communication authority
        ↓
exact recipient resolution in Wiserr
        ↓
canonical Wiserr outbound messaging
        ↓
reply
        ↓
Luna qualification / booking
        ↓
canonical booking / sale outcome
        ↓
GrowthOS attribution + experiment close
        ↓
learning
        ↓
next best action
```

## Important separation now encoded

```text
Wiserr snapshot
→ cohort + eligibility evidence

Capacity authority
→ permission to increase demand

SMS execution authority
→ permission to send dormant-lead marketing SMS
```

A snapshot can be `PARTIAL`, have embedded capacity `UNKNOWN`, and have `reactivationSms=false`, while planning remains possible from aggregate eligibility. Execution still requires independent current capacity and communication proofs.

---

# 9. WHAT IS ALREADY BUILT IN GROWTHOS

The following is not conceptual only; it is implemented in code/tests on current GrowthOS `main` unless repository truth has moved after this handoff.

## 9.1 Foundation / control plane

- dedicated GrowthOS repository;
- canonical architecture/boundary docs;
- world-class autonomous agency blueprint;
- Wiserr + AI Studio integration contracts;
- L0–L5 autonomy model;
- deterministic action-policy evaluator;
- tenant/action-family enforcement;
- channel/account/geography restrictions;
- recipient/attempt/spend/change ceilings;
- capacity-aware `NO_ACTION`;
- budget/price/discount escalation;
- exact action approval fingerprint;
- immutable policy decision receipts;
- external delegation assertions;
- explicit granting actor vs delegate subject;
- envelope activation/revocation/replacement lifecycle;
- durable action envelopes;
- cross-repo authority receipts;
- semantic upstream contract fingerprints.

## 9.2 Crash/retry/reconciliation safety

- execution-attempt state machine;
- durable action-scoped attempt history;
- stable idempotency identity;
- unresolved attempt blocks another attempt;
- SUBMITTING/ACCEPTED/unknown outcome requires reconciliation;
- definitive failure vs not-accepted vs ambiguous outcome separated;
- attempt ceilings survive restart;
- restart recovery inspector;
- persisted commands included in recovery inspection;
- no unattended replay on unresolved state.

## 9.3 Durable runtime / PostgreSQL readiness

- dedicated `GROWTHOS_DATABASE_URL`; no fallback to Wiserr DB URL;
- CAS/versioned records;
- append-only events;
- payload integrity hashes;
- tenant/type/index-scoped recovery;
- immutable secondary recovery keys;
- atomic state + evidence-event mutation;
- Postgres adapter contract;
- pool transaction adapter;
- SQL migrations;
- checksum-safe migration runner;
- advisory migration lock;
- migration checksum drift refusal;
- database certification evaluator;
- schema/migration/index/rollback probe;
