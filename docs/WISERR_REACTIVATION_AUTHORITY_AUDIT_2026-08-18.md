# Wiserr Reactivation Authority Audit — 2026-08-18

## Purpose

Define the exact boundary for GrowthOS's first production loop: owned-demand reactivation through existing Wiserr authority.

GrowthOS must not recreate CRM, suppression, telecom, booking, or Luna authority. It should consume bounded business state, decide whether a reactivation opportunity is justified, produce an exact governed plan, and delegate execution/outcome truth back to Wiserr.

## Verified current Wiserr authorities

### Canonical lead/contact state

`server/stores/postgres/postgresLeadStore.ts` is a canonical lead/contact authority with tenant-scoped records including:

- `id`
- `tenantSlug`
- `phone`
- `email`
- `stage`
- `source`
- `preferredLocale`
- `smsOptOut`
- `emailOptOut`
- `whatsappOptOut`
- `doNotContact`
- `optOutSourceReason`
- `createdAt`
- `updatedAt`
- version token / governed mutation support

GrowthOS must not maintain a competing contact or opt-out source of truth.

### Canonical customer history

Wiserr exposes contact history through the leads/contact-history path. GrowthOS should request a purpose-built aggregate/cohort contract rather than pull arbitrary raw history.

### Canonical SMS execution

`server/messaging/sendTenantSms.ts` states that it is the only blessed outbound SMS entry point.

It already owns:

- tenant sender resolution
- provider routing
- kill switch
- opt-out / DNC checks
- fail-closed eligibility
- tenant SMS compliance gate
- purpose allowlist
- rate limits
- correlation IDs
- provider acceptance state
- external message IDs
- orchestration/idempotency support
- ambiguous/manual-resolution semantics

GrowthOS must never call Twilio/Vonage/Telnyx/Plivo directly for a Wiserr tenant.

### Messaging suppression

`server/messaging/messagingSafety.ts` owns cross-channel/global DNC and SMS opt-out checks. Verification errors fail closed.

GrowthOS may use aggregate eligibility counts for planning but final recipient eligibility must be re-evaluated by Wiserr at execution time.

### Follow-up / conversion workflow

Wiserr already has deterministic follow-up machinery and explicit stop conditions such as replied, booked, opted out, and max attempts. GrowthOS should orchestrate campaign intent and measurement, not duplicate this engine blindly.

### Lead/business outcome signals

Wiserr lead state includes canonical stages (`new`, `contacted`, `qualified`, `proposal`, `won`, `lost`) and emits canonical lead/business events. GrowthOS should consume canonical Wiserr events/outcomes for attribution rather than mutate sales truth itself.

## Required integration pattern

```text
Wiserr canonical business data
        ↓
Purpose-built Growth Read Contract
        ↓
GrowthOS opportunity detector
        ↓
Exact Reactivation Plan
        ↓
GrowthOS Action Envelope + approval hash
        ↓
Wiserr resolves final eligible recipients
        ↓
Wiserr canonical messaging authority executes
        ↓
Replies / Luna / booking remain Wiserr-owned
        ↓
Canonical outcome events
        ↓
GrowthOS attribution + learning
```

## Read contract

The first GrowthOS read contract should expose aggregate planning evidence, not unrestricted tables.

Minimum fields:

- tenant ID/slug
- snapshot ID
- generated/freshness timestamp
- completeness state
- operational capacity state
- dormant cohort count
- eligible-by-channel counts
- suppression count
- cohort definition/version
- latest relevant contact/activity cutoff
- current pipeline/booking pressure sufficient to make a demand decision
- capability flags for available outbound channels

GrowthOS should not need raw PII until an approved action is ready for execution.

## Execution contract

After approval, GrowthOS sends Wiserr an exact execution request containing:

- action ID
- action fingerprint
- opportunity ID
- campaign/experiment ID
- tenant ID
- cohort definition ID/version
- approved channel
- approved message/template version or exact body where appropriate
- max recipients
- attempt number
- correlation/idempotency key
- stop/frequency policy
- observation horizon

Wiserr then:

1. re-resolves the cohort from canonical data;
2. applies current DNC/opt-out/compliance/kill-switch/rate-limit policy;
3. executes only eligible sends through canonical adapters;
4. returns per-recipient outcome classifications without pretending suppression is failure;
5. preserves ambiguous provider outcomes distinctly from definitive failures.

## Important gap discovered

The existing `SmsPurpose` vocabulary is oriented toward transactional/follow-up traffic. A GrowthOS reactivation campaign should not be smuggled through an unrelated purpose value.

Before production reactivation, Wiserr needs an explicit governed marketing/reactivation purpose with its own compliance and shared-campaign rules, or another approved channel authority specifically intended for marketing outreach.

GrowthOS must fail closed until that capability exists and is reported by the Wiserr read/capability contract.

## No-duplication rules

GrowthOS must not own:

- lead/contact master records
- DNC / opt-out truth
- tenant phone numbers
- carrier/provider routing
- SMS compliance state
- inbound reply authority
- Luna customer conversation state
- appointments/jobs
- won/lost sales truth

## First implementation objective

Build and test GrowthOS-side contracts and plan generation now. Do not issue a real send until Wiserr exposes the explicit read/execution capability needed for reactivation marketing and that exact capability is certified.