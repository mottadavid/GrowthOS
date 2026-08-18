# GrowthOS Decision Log

## 2026-08-18 — Separate service/repository, first-class Wiserr subsystem

**Decision:** GrowthOS lives in its own repository/service while strategically belonging to Wiserr.

**Why:** Growth execution has different dependencies, external APIs, workloads, failure modes, and experimentation cadence than the Wiserr core. Separation reduces blast radius and preserves optionality while explicit contracts keep the product integrated.

## 2026-08-18 — Wiserr owns canonical business truth

**Decision:** GrowthOS does not build a competing CRM, tenant authority, appointment/job authority, or Luna permission model.

**Why:** growth decisions are strongest when grounded in the actual operating system, and duplicate authorities create drift.

## 2026-08-18 — AI Studio is the creative department

**Decision:** GrowthOS requests creative intent/results from `wiserr-ai-studio`; it does not duplicate Content Farm, synthetic character intelligence, Viral Format Discovery, avatar/video providers, or creative QC.

**Why:** creative production is already a distinct experimental subsystem with strict provenance, media, consent, cost, and QC boundaries.

## 2026-08-18 — GrowthOS optimizes business outcomes, not activity

**Decision:** posts, views, clicks, leads, and campaign volume are intermediate signals.

**Why:** the system should choose reactivation, conversion, reviews, local marketing, content, paid acquisition, or even no action based on expected business value.

## 2026-08-18 — Specialized departments, not one giant agent

**Decision:** use narrow specialist roles/workflows coordinated by a Chief Growth Strategist.

**Why:** tool permissions, context, evaluation, failure handling, and accountability are easier to govern when responsibilities are bounded.

## 2026-08-18 — Deterministic control plane authorizes execution

**Decision:** agents reason and propose; deterministic policy decides whether actions may execute.

**Why:** model confidence cannot safely enforce budgets, permissions, pricing authority, retries, compliance, or tenant boundaries.

## 2026-08-18 — Autonomy is action-specific

**Decision:** use autonomy levels `L0`–`L5` per action family and policy envelope rather than a global autonomous toggle.

**Why:** reading metrics, publishing approved content, launching ads, changing prices, and increasing budget have materially different risk.

## 2026-08-18 — No uncontrolled spend or autonomous budget expansion

**Decision:** paid-media/provider execution must have explicit budget/resource ceilings; total approved spend cannot be increased autonomously.

**Why:** an optimizing agent must not use additional spend as an unconstrained recovery mechanism.

## 2026-08-18 — Operational capacity constrains marketing

**Decision:** canonical business capacity is a first-class growth input.

**Why:** acquiring more demand can be harmful when the business cannot fulfill it. Conversion/reactivation/retention may outrank acquisition.

## 2026-08-18 — Restraint is a valid strategy

**Decision:** `NO_ACTION` is a first-class system outcome.

**Why:** insufficient evidence, noise, capacity constraints, or poor economics should not trigger invented interventions.

## 2026-08-18 — Experiments require explicit hypotheses and stop rules

**Decision:** GrowthOS should not create variants simply because generation is cheap.

**Why:** world-class growth comes from disciplined learning rather than autonomous content volume.

## 2026-08-18 — First vertical slice is owned-demand reactivation

**Decision:** prove the architecture first through a dormant-lead/customer reactivation loop connected to Wiserr and Luna.

**Why:** it can close the strategy → authority → execution → response → appointment/sale → attribution loop with lower platform complexity and typically strong service-business economics.

## 2026-08-18 — Product packaging remains undecided

**Decision:** do not decide yet whether GrowthOS becomes a Wiserr tier, add-on, managed service, vertical product, standalone service, or multiple forms.

**Why:** architecture and real-client results should precede packaging decisions.
