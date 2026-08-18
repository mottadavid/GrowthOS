# Autonomy and Marketing Control Plane

## Principle

GrowthOS autonomy is **bounded and action-specific**. There is no global `autonomous=true` mode.

Every executable action must pass a deterministic authority evaluation immediately before execution.

## Autonomy levels

### L0_OBSERVE
Read/measure only.

Examples:
- fetch campaign metrics
- inspect pipeline conversion
- monitor review velocity

### L1_RECOMMEND
Produce recommendation with evidence. No executable artifact required.

### L2_DRAFT
Prepare a concrete action/campaign/message/creative request, but execution is forbidden.

### L3_APPROVAL_REQUIRED
Action is executable only after explicit approval tied to the exact action/envelope version.

Examples:
- launch a new paid campaign
- change an offer
- publish sensitive founder content
- create a material discount

### L4_BOUNDED_AUTONOMOUS
May execute without per-action approval only inside a previously approved deterministic envelope.

Examples:
- optimize bids inside a fixed campaign budget range
- publish pre-approved scheduled content
- send a reactivation sequence under approved audience/message rules

### L5_LOW_RISK_AUTONOMOUS
Reserved for explicitly designated low-risk, reversible actions.

Examples may include internal tagging or routine metric collection. Do not use L5 as shorthand for “agent can do anything.”

## Action Envelope

A policy envelope should be explicit enough that two independent implementations can determine whether an action is allowed.

Typical fields:

```text
tenant
actor/service authority
action family
autonomy level
validity window
channels
accounts
geography
audiences
allowed offers/messages
forbidden claims
spend/day
spend/total
provider-unit limits
max change percentage
max attempts
approval requirements
operational capacity constraints
compliance/brand policy version
```

## Decision outcomes

The control plane returns one of:

- `ALLOW`
- `REQUIRE_APPROVAL`
- `DENY`
- `NO_ACTION`

`NO_ACTION` is semantically distinct from `DENY`.

- `DENY`: requested action violates policy/authority.
- `NO_ACTION`: system intentionally decides no intervention is justified.

## Spend doctrine

Never autonomously increase the overall authorized budget.

An approved envelope may permit reallocation inside limits, for example:

```text
Meta account X
$50/day maximum
$500 total experiment maximum
±20% allocation shifts among approved ad sets
new creative from approved set only
no geography expansion
```

An agent recommendation to increase the envelope requires new approval.

## Offer/pricing doctrine

Offer creation and pricing changes are consequential business actions.

Default:
- analyze/recommend: autonomous
- draft offer: autonomous
- publish/activate new offer: approval required
- discount/guarantee changes: approval required unless a narrow envelope explicitly permits them

## Capacity doctrine

Growth cannot be evaluated independently from fulfillment capacity.

The control plane may block or redirect demand-generation actions when canonical business state indicates capacity constraints.

Example:

```text
roofing estimate backlog > policy threshold
→ deny incremental acquisition increase
→ allow quote follow-up/reactivation actions
```

## Freshness doctrine

Approval applies to a specific action and evidence state.

Before execution, the system should re-check volatile assumptions such as:
- remaining budget
- account status
- operational capacity
- offer validity
- audience size/eligibility
- channel permissions
- required creative approval

If material inputs changed, require a new preflight/approval rather than silently substituting.

## Retry doctrine

No uncontrolled retries.

For operations that can spend money, contact customers, publish externally, or duplicate actions:
- record attempt ID/idempotency key when supported
- distinguish definitive failure from ambiguous outcome
- reconcile ambiguous outcomes before retry
- respect per-action attempt ceiling

## Human override

Authorized humans can pause or revoke an envelope. Revocation must block new execution immediately.

Already-executed external actions may require explicit rollback/cancel operations; do not pretend revocation rewinds history.

## Auditability

Every evaluation should record:
- exact action request hash/version
- policy/envelope version
- evidence/freshness snapshot IDs
- decision
- reasons
- required approval if any
- execution result reference

## Example policy matrix

| Action | Default level |
|---|---|
| Read metrics | L5 |
| Detect opportunity | L1 |
| Draft campaign | L2 |
| Draft creative request | L2 |
| Publish pre-approved scheduled content | L4 |
| Ordinary review request sequence | L4 after envelope approval |
| Reactivate approved dormant segment | L4 after envelope approval |
| Launch new paid test | L3 |
| Pause campaign breaching hard rule | L4 if explicitly authorized |
| Optimize spend allocation within fixed envelope | L4 |
| Increase total ad budget | L3 |
| Change public price | L3 |
| Create new guarantee/discount | L3 |
| Make unsupported customer promise | DENY |
