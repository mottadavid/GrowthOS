# AGENTS.md — GrowthOS Operating Contract

This file is mandatory context for any agent working in GrowthOS.

## Mission

GrowthOS is an autonomous growth operating system for service businesses. Its job is not to maximize marketing activity. Its job is to continuously identify and execute the **highest-value justified growth action** within explicit business, brand, budget, compliance, and autonomy boundaries.

The target loop is:

```text
business truth
→ market/customer intelligence
→ growth opportunities
→ strategy
→ governed execution
→ lead/customer response
→ sale/business outcome
→ attribution
→ learning
→ next best action
```

## System boundaries

GrowthOS is strategically part of Wiserr but technically its own service while being proven.

**Wiserr OS owns canonical business truth:** tenant identity, users/permissions, contacts/customers/leads, conversations, appointments/jobs, operational state, CRM/pipeline, Luna, and authoritative business outcomes.

**GrowthOS owns growth intelligence and execution state:** growth goals, opportunities, strategies, campaigns, marketing action envelopes, distribution, paid media, local/SEO/GEO, reputation, lifecycle/reactivation, experiments, attribution, and growth learning.

**AI Studio owns creative intelligence/production:** Human Content Farm, Brand Character Intelligence, Viral Format Discovery, identity/voice/video production, creative QC, and creative production economics.

Do not duplicate another system's authority because it is convenient.

## Required knowledge pass

Before material work read:

1. `README.md`
2. `AGENTS.md`
3. `docs/VISION.md`
4. `docs/ARCHITECTURE.md`
5. `docs/SYSTEM_BOUNDARIES.md`
6. `docs/AUTONOMY_CONTROL_PLANE.md`
7. `docs/SAFETY.md`
8. `docs/ROADMAP.md`
9. `docs/DECISIONS.md`
10. relevant contract/schema docs

### Required cross-repo merge pass

If work touches or depends on Wiserr OS, AI Studio, or another repository, also read `docs/MERGE_COORDINATION.md` and perform its upstream-authority preflight before writing integration code.

At minimum:

- inspect current GrowthOS `main` and open PRs;
- inspect current upstream `main`;
- inspect active upstream PRs/trains that may touch the authority;
- distinguish `OBSERVED`, `CANDIDATE`, and `CERTIFIED` upstream behavior;
- do not treat a draft/green PR as canonical authority;
- prefer isolated GrowthOS work when upstream shared surfaces are congested;
- re-check upstream authority immediately before merge.

A previously inspected upstream behavior is not permission to assume it still exists unchanged.

## Core doctrines

### 1. Outcome before activity

Views, posts, emails, ads, and leads are intermediate signals. Optimize toward business outcomes such as qualified conversations, appointments, sales, revenue, retention, capacity utilization, and profit-relevant proxies.

### 2. Restraint is a valid action

GrowthOS may conclude `NO_ACTION` when evidence is weak, sample size is inadequate, capacity is constrained, or intervention is not justified. Autonomous systems must not manufacture work merely to appear active.

### 3. Intelligence proposes; deterministic policy authorizes

An LLM/agent may recommend an action. A deterministic control plane decides whether that action may execute.

Never let model confidence substitute for:
- tenant authority
- budget ceilings
- channel permissions
- offer/pricing authority
- brand/compliance rules
- operational capacity
- approval requirements
- rate/retry limits

### 4. Autonomy is per action family

There is no single global autonomous switch. Every action family has an autonomy level and policy envelope.

### 5. No uncontrolled spend

Paid media, provider usage, promotional discounts, credits, and any other scarce resource require explicit limits. Never autonomously increase total approved spend.

### 6. No competing CRM or business truth

GrowthOS may maintain derived read models and attribution state. It must not silently become a second source of truth for customers, jobs, appointments, invoices, or business outcomes when Wiserr owns them.

### 7. Experiments require hypotheses

Do not generate variants for their own sake. Significant tests should record hypothesis, variables, budget, success condition, evidence, and decision.

### 8. Creative truth remains external authority

GrowthOS can request creative from AI Studio but must respect provenance. Human stories come from source-backed Content Farm material. Synthetic brand characters use brand/product/industry authority and must not fabricate firsthand human biography.

### 9. Tenant isolation is non-negotiable

All reads, decisions, actions, events, budgets, credentials, and outcomes are tenant scoped.

### 10. Continuity lives in the repository

Durable architecture, doctrine, schemas, contracts, and decisions belong here, not only in chat.

### 11. Upstream authority must be current

Cross-repo execution capability requires a current, certified upstream authority receipt. If the upstream head moved and the relevant authority fingerprint has not been reverified, review is required. If the required capability is false, absent, or revoked, execution is denied.

## Autonomy levels

- `L0_OBSERVE` — measure only
- `L1_RECOMMEND` — recommend action
- `L2_DRAFT` — prepare executable artifact but do not execute
- `L3_APPROVAL_REQUIRED` — execution requires explicit approval
- `L4_BOUNDED_AUTONOMOUS` — may execute inside deterministic envelope
- `L5_LOW_RISK_AUTONOMOUS` — autonomous only for low-risk reversible operations explicitly designated as such

Agents must never self-promote an action to a higher autonomy level.

## Definition of a world-class GrowthOS action

A production action should be traceable to:

```text
business state
+ evidence
+ opportunity/hypothesis
+ strategy
+ authority/policy
+ exact action
+ cost/risk
+ execution result
+ downstream outcome
+ learning
```

If those links cannot be established, do not claim the system learned causally from the action.
