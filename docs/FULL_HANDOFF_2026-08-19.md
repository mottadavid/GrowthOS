# GrowthOS / Autonomous Agency — Complete New-Chat Handoff

**As of:** 2026-08-19 evening ET  
**Primary repo:** `mottadavid/GrowthOS`  
**GrowthOS main observed during final audit:** `a243d003cfc762e7c8badd5cabf61276dd6494e6`  
**Related repos:** `mottadavid/Wiserr-OS`, `mottadavid/wiserr-ai-studio`

> **Continuity rule:** many Wiserr/GrowthOS branches merge concurrently. At the start of a new session, re-read current `main`, open PRs, GrowthOS Issue #1, and the canonical docs. Never stale-merge because an old-base CI run was green. This handoff preserves product intent, architecture, doctrine, and the latest audited state; repository truth wins if newer.

---

# 0. Paste this into the new chat

> We are continuing the GrowthOS / autonomous agency project. Act as CTO/lead product architect and work from repository truth, not chat assumptions. First audit `mottadavid/GrowthOS` current `main`, `README.md`, `AGENTS.md`, `docs/FULL_HANDOFF_2026-08-19.md`, GitHub Issue #1, `docs/WORLD_CLASS_AGENCY_BLUEPRINT.md`, `docs/ARCHITECTURE.md`, `docs/SYSTEM_BOUNDARIES.md`, `docs/AUTONOMY_CONTROL_PLANE.md`, `docs/SAFETY.md`, `docs/RUNTIME_PERSISTENCE.md`, and the current code/tests. Then inspect the current relevant authorities in `mottadavid/Wiserr-OS` and `mottadavid/wiserr-ai-studio` before changing cross-repo contracts. Continue the highest-value next slice toward one real closed revenue loop. Preserve fail-closed tenant/authority/capacity/consent/budget/retry rules, exact approval binding, durable evidence, no blind retry after ambiguous side effects, conservative attribution, and `NO_ACTION` when intervention is not justified. Do not expand into Meta/Google/social/SEO agents until the first revenue loop is proven unless current repo evidence changes the priority.

---

# 1. Why this exists

The project began as a way to serve marketing clients without building a labor-heavy agency. Client Zero is **CKO Accounting Services / Cristiane**. The discussed managed fee was about **$1,200/month**, accepted below the preferred price to prove the model and potentially create a Wiserr referral/channel relationship.

The recurring customer problem is clear: service businesses need more business, but many distrust agencies and do not want extra ad spend after being burned before. The service therefore needs to produce measurable outcomes with minimal recurring operator time and should prioritize actions that can work from the management fee before defaulting to paid media.

Initial non-paid levers:

- database/dormant-demand reactivation;
- organic/social content;
- reviews/referrals;
- local SEO/GEO/discoverability;
- conversion/follow-up;
- email/SMS/lifecycle;
- offer improvement;
- paid media later or when evidence/client intent justifies it.

The key evolution was from **“automate agency tasks”** to:

> **Continuously identify and execute the highest-value justified growth action for the business.**

Sometimes the correct action is a Reel. Sometimes reactivation. Sometimes reviews. Sometimes ads. Sometimes fixing follow-up. Sometimes **NO_ACTION** because evidence is weak or the business cannot fulfill more demand.

---

# 2. North Star

Build a **world-class autonomous growth operating system for service businesses** that:

1. continuously understands the business;
2. understands customers, pipeline, capacity, economics, and outcomes;
3. observes relevant market/customer/channel evidence;
4. identifies the highest-value justified opportunities;
5. proposes or executes within owner-defined authority;
6. uses deterministic software to enforce policy, tenant, budget, capacity, consent, and retry boundaries;
7. converts demand through Wiserr/Luna rather than stopping at lead generation;
8. attributes outcomes conservatively;
9. learns from bookings/sales/revenue rather than vanity metrics;
10. reduces recurring human labor without reducing quality or control.

Target operating model:

```text
senior human strategy / exception judgment
        +
governed autonomous recurring execution
        +
closed-loop business outcome learning
```

---

# 3. Product/repository boundaries

## Wiserr OS owns canonical business truth

Wiserr remains authority for tenants/users/permissions, contacts/customers/leads, CRM/pipeline, inbox/conversations, Luna, appointments/jobs, operational capacity authorities, opt-outs/DNC, canonical messaging, and canonical booking/sale/business outcomes.

**GrowthOS must not create a competing CRM, permission system, messaging stack, or booking authority.**

## GrowthOS owns growth intelligence + governed orchestration

GrowthOS owns growth goals, opportunities, strategy/action portfolios, offer hypotheses, action envelopes/autonomy, campaign orchestration, future distribution/paid/local/SEO-GEO/reputation/lifecycle strategy, experiments, attribution, learning, and the marketing control plane.

## AI Studio owns creative intelligence + production

`wiserr-ai-studio` owns Human Content Farm, Brand Character Intelligence, Viral Format Discovery, Identity Profiles, human/synthetic/licensed identity provenance, voice/avatar/video/image/text production, provider orchestration, creative QC, and creative economics/provenance.

GrowthOS decides **why/what/where** creative is needed. AI Studio decides **how** approved creative is produced.

## Product shape

Strategically GrowthOS is part of Wiserr. Technically it remains a separate service/repo while being proven. UX can ultimately live mainly inside Wiserr/Luna. This preserves optionality for managed agency, Wiserr add-on, vertical packages, or standalone GrowthOS.

---

# 4. World-class autonomous agency blueprint

GrowthOS should become specialized governed departments, not one giant agent.

1. **Business & Customer Intelligence** — services, economics, goals, capacity, seasonality, customers/leads, pipeline, conversion, feedback, channel history.
2. **Market Intelligence** — search demand, competitors, local market, reviews, content/platform patterns, offer/category movement.
3. **Chief Growth Strategist** — ranks the best justified action across departments; can choose reactivation, conversion, reviews, local, content, SEO/GEO, paid, offer work, throttling, or NO_ACTION.
4. **Offer Strategy** — pain/urgency, economics, proof, competition, capacity, pricing/risk reversal/CTA; consequential changes require approval.
5. **Content & Creative** — delegated to AI Studio.
6. **Distribution** — approved artifact → channel adaptation → schedule/publish/send → verify external ID → capture failures → measure.
7. **Paid Acquisition** — later, bounded by account/objective/geography/audience/creative/budget/stop/validity envelopes; never unconstrained spend.
8. **Lead Conversion / Lifecycle** — GrowthOS intent, Wiserr/Luna conversation/booking authority.
9. **Attribution / Experiment / Learning** — source/story → creative → channel → signal → lead → booking → sale → revenue → cost/time, with conservative causal claims.

Strategy horizons: real-time incidents; daily execution; weekly creative/lead-quality/experiments; monthly offer/channel/economics; quarterly ICP/positioning/market strategy.

---

# 5. Autonomy doctrine

No global `autonomous=true`.

```text
L0 OBSERVE
L1 RECOMMEND
L2 DRAFT
L3 APPROVAL_REQUIRED
L4 BOUNDED_AUTONOMOUS
L5 LOW_RISK_AUTONOMOUS
```

L5 is not numerically “more authority” than L4; allowed levels are explicit sets.

Core rule:

> **Intelligence proposes. Deterministic policy decides whether execution is permitted.**

Policy decisions are `ALLOW`, `REQUIRE_APPROVAL`, `DENY`, or `NO_ACTION`.

The control plane checks tenant, delegate, action family, channel/account/geography, spend, recipients, attempts, capacity, freshness, approvals, validity windows, and consequential changes.

---

# 6. Non-negotiable doctrine

- Tenant isolation is load-bearing.
- Transport existence is not execution authority.
- `authoritative: true` is not capacity authority.
- Read authority, capacity authority, communication authority, autonomy authority, policy approval, execution certainty, and attribution are separate.
- Approval binds the exact consequential action; mutation invalidates it.
- Unknown external outcome becomes reconciliation work, never blind retry.
- Historical authority remains immutable evidence even if live authority is later revoked.
- Failure should reduce autonomy, not widen it.
- Startup defaults read-only; healthy infrastructure is not execution permission.
- `NO_ACTION` is a valid high-quality result.
- Do not equate engagement with revenue.
- DIRECT attribution requires canonical outcome + direct correlation + evidence.
- Compact audit evidence should use IDs/hashes instead of private message content where possible.
- Cross-repo authority uses OBSERVED/CANDIDATE/CERTIFIED/REVOKED receipts and semantic fingerprints.
- Never stale-merge cross-repo work merely because CI passed on an old base.

---

# 7. First vertical slice: owned-demand reactivation

Chosen before ads/social/SEO because it can prove the full revenue loop with lower platform complexity and without requiring ad spend.

```text
canonical Wiserr business state
→ dormant demand detected
→ GrowthOS opportunity
→ campaign hypothesis
→ exact approval/action envelope
→ current capacity proof
→ current communication authority
→ exact recipient resolution in Wiserr
→ canonical Wiserr outbound messaging
→ reply
→ Luna qualification/booking
→ canonical booking/sale outcome
→ GrowthOS attribution/experiment close
→ learning
→ next best action
```

Critical separation now encoded:

```text
Wiserr snapshot = cohort + eligibility evidence
Capacity authority = permission to increase demand
SMS authority = permission to send dormant-lead marketing SMS
```

A snapshot may remain `PARTIAL`, embedded capacity `UNKNOWN`, and `reactivationSms=false`; planning can still use aggregate eligibility. Execution requires independent current capacity and communication proofs.

---

# 8. What GrowthOS has built

## Control plane / authority

- deterministic action-policy evaluator;
- tenant/action-family/channel/account/geography enforcement;
- recipient/attempt/spend/change ceilings;
- capacity-aware NO_ACTION;
- budget/price/discount escalation;
- exact approval-bound action fingerprint;
- immutable policy receipts;
- external delegation authority;
- granting actor separated from delegate subject;
- durable envelope activation/revocation/replacement;
- cross-repo authority receipts and semantic fingerprints;
- process-level execution kill switch.

## Runtime durability / PostgreSQL readiness

- `GROWTHOS_DATABASE_URL` only; no fallback to Wiserr `DATABASE_URL`;
- CAS/versioned state records;
- append-only events;
- tenant/type/index-scoped recovery;
- payload integrity hashes;
- immutable secondary recovery keys;
- atomic state + evidence-event mutation;
- Postgres store + transaction adapter;
- transaction-neutral SQL migrations;
- checksum-safe migration runner + advisory lock;
- checksum drift refusal;
- database certification evaluator;
- schema/migration/index/rollback probe;
- startup readiness gate;
- read-only bootstrap by default;
- execution requires explicit request + process enablement + clean readiness;
- restart recovery inspector.

**Still not proven:** actual GrowthOS DB/user provisioned, migrations against live Postgres, live integration test, forced rollback on real DB, real restart/recovery drill, backup restore proof, production DB secret deployment.

## Capacity

- capacity evidence model;
- complete/fresh/authoritative requirement for `AVAILABLE`;
- FULL/CONSTRAINED precedence;
- stale/expired evidence → UNKNOWN/throttle;
- capacity-source authority assertions;
- constraint-only authority can throttle but cannot grant availability;
- forged `authoritative: true` cannot unlock demand;
- durable capacity evidence + authority bundle;
- execution-time capacity proof.

## Business state / opportunity

- bounded Wiserr growth snapshot schema;
- read-client authority/freshness/tenant validation;
- durable certified snapshot + upstream proof;
- source-derived dormant-demand opportunity;
- opportunity identity binds snapshot hash + capacity semantic hash + detector policy hash;
- stale source/expired capacity cannot reuse a historical opportunity as current.

## Campaign / experiment / policy

- exact reactivation plan + approval hash;
- durable campaign lifecycle;
- external approval authority reference;
- execution-time revalidation;
- current eligibility can reduce dispatch ceiling;
- cohort drift blocks/requires reapproval;
- deterministic experiment lifecycle;
- durable experiment approval/evidence/guardrails/closure;
- durable exact policy action + evaluated envelope + receipt.

## Execution safety

- durable action-scoped execution attempts;
- stable idempotency;
- unresolved attempt blocks another attempt;
- definitive failure / not accepted / ambiguous separated;
- exact Wiserr command binds campaign/experiment/policy/envelope/action/attempt/snapshot/capacity/SMS authority;
- exact command persisted immutably before handoff;
- command tamper detection;
- restart inspector includes persisted commands;
- submission preparation persists `campaign=EXECUTING` and `attempt=SUBMITTING` before transport receives the command;
- once attempt is `SUBMITTING`, command replay is refused and reconciliation is required;
- command can resume only in the safe pre-external-contact window (`EXECUTING` + attempt still `CREATED`);
- transport/result/reconciliation coordination exists on current main per Issue #1; re-audit exact modules before changing it.

## Outcomes / learning

- durable canonical business-outcome repository;
- dedup by canonical business outcome, not webhook delivery ID;
- execution certainty separated from attribution confidence;
- DIRECT attribution requires evidence;
- durable Growth Run Manifest;
- final proof built from persisted authoritative records;
- frozen evaluated envelope preserves historical authority after later revocation;
- sealed run proof cannot silently absorb later outcomes;
- execution economics ledger exists per current tracker; exercise it in first live loop.

---

# 9. Wiserr integration status

The repeatedly recut bounded producer was finally merged as **Wiserr PR #1726**. It is deliberately conservative:

- aggregate dormant cohort only;
- no recipient PII;
- `PARTIAL` completeness;
- embedded capacity `UNKNOWN`;
- channel eligibility separated from execution capability;
- execution/Luna/outcome capabilities false in the producer itself.

GrowthOS current `main` observed during this handoff contains a later commit titled **“certify mounted Wiserr snapshot authority from retained evidence.”** Therefore the read side has progressed beyond the older Issue #1 wording. **New chat must re-audit current GrowthOS/Wiserr main and retained certification evidence before assuming the exact mounted route/capability state.**

Do not infer from read certification that SMS, Luna campaign context, booking outcomes, or revenue outcomes are certified.

## Wiserr messaging facts already audited

Wiserr already has a canonical SMS authority with kill switch, suppression/DNC handling, tenant program/compliance checks, rate limits, idempotency/correlation, provider orchestration, and ambiguity/reconciliation behavior.

But **“Wiserr can send SMS” is not “GrowthOS may send dormant-lead marketing SMS.”**

GrowthOS therefore has a separate dependency `wiserr-reactivation-sms-v1`. Its observed state remains non-executable until evidence proves all required pieces, including an explicit GrowthOS/reactivation marketing purpose, compliance review, campaign/use-case coverage, consent/opt-in evidence, canonical send path, result classification, and reconciliation lookup.

**Never repurpose `follow_up`, Luna, or transactional purposes as marketing authority.**

---

# 10. AI Studio / creative program

AI Studio is a separate but connected workstream.

## Three engines

1. **Content Farm** — what authentic thing should be said?
2. **Viral Format Discovery** — how should a verified idea be packaged?
3. **AI Studio Production** — how is it produced through identity/voice/avatar/video/edit/QC/review?

## Human Content Farm doctrine

> **Excavate, do not fabricate.**

Real client life, expertise, beliefs, mistakes, stories, and vocabulary are source-backed. Story Atoms have source references and truth states such as `DIRECT`, `SUPPORTED_INFERENCE`, `NEEDS_CONFIRMATION`, `PRIVATE`, `REDACTED`.

The secure interview foundation exists. The **real methodology is intentionally waiting on the purchased storytelling course/resources**. Do not guess it.

Next after course ingestion: adaptive follow-up → Story Atoms → confirmation queue → Story Bank → Content Seeds → source-backed drafts.

## Synthetic brand characters

AI Studio must support more than human clones. Long-term identity origins:

- `AUTHORIZED_HUMAN`;
- `ORIGINAL_SYNTHETIC`;
- `LICENSED_CHARACTER`.

Synthetic characters use a **Character Bible**, not fake Content DNA. They may represent brand/product/industry knowledge but must not fabricate firsthand human history. Example: a BuildOS contractor character can explain