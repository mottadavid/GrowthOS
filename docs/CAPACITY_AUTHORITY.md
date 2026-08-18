# Capacity Authority

GrowthOS must not create demand from a guess about whether a business can fulfill it.

Capacity is therefore an external business authority, not a marketing heuristic.

## Core rule

> `AVAILABLE` requires fresh, complete-for-purpose, authoritative operational evidence.

GrowthOS may use weaker evidence to justify restraint, but never to manufacture headroom.

## Why a universal heuristic is wrong

Capacity means different things by vertical:

- construction: estimating backlog, crew availability, project start windows, trade capacity, cash/material constraints;
- salon/beauty: professional schedules, service duration, chair/room constraints, booking windows;
- accounting: filing deadlines, preparer workload, client-document readiness, service mix;
- other service businesses: staff/asset availability, booked hours, geography, SLA, inventory or other real constraints.

A generic metric such as "calendar is only 70% full" is not a universal capacity authority.

## Capacity evidence contract

Every adapter produces a versioned evidence object with:

- tenant and scope;
- source system and source authority;
- `asOf` and optional expiry;
- completeness;
- one or more evidence signals;
- an explicit authoritative/non-authoritative classification per signal.

Signals have one of four verdicts:

- `AVAILABLE`
- `CONSTRAINED`
- `FULL`
- `INFORMATIONAL`

## Conservative precedence

The deterministic resolver applies:

```text
fresh authoritative FULL
→ FULL

else fresh authoritative CONSTRAINED
→ CONSTRAINED

else partial / stale / expired / no authoritative signal
→ UNKNOWN

else complete-for-purpose + authoritative AVAILABLE
→ AVAILABLE
```

Constraint wins over optimism.

An authoritative `FULL` signal beats simultaneous available/constrained signals and records the conflict. An authoritative `CONSTRAINED` signal beats an available signal.

## Demand throttle

GrowthOS sets `demandThrottleRecommended=true` for:

- `FULL`
- `CONSTRAINED`
- `UNKNOWN`

Only `AVAILABLE` clears the demand throttle.

This is intentionally asymmetric: uncertainty may stop acquisition, but uncertainty may not authorize more acquisition.

## Vertical adapters

GrowthOS does not own the underlying operational facts. A vertical adapter must identify the canonical authority inside Wiserr or another approved system and translate only those facts into the capacity evidence contract.

Examples of future adapters:

```text
Wiserr BuildOS operational capacity
→ capacity evidence

Wiserr Beauty/Service schedule authority
→ capacity evidence

Wiserr Accounting workload authority
→ capacity evidence
```

Do not build an adapter until the vertical's actual source of truth is identified and its semantics are understood.

## Scope

Capacity may be narrower than a tenant.

A business can be:

- full for one service but open for another;
- full in one location but open in another;
- constrained this week but available next month.

`scopeKey` exists to prevent tenant-wide conclusions from evidence that applies only to one service/location/time horizon.

## Relationship to GrowthOS opportunities

Opportunity detection may consume capacity only through the derived business-state capacity object.

Demand-increasing opportunities must fail closed when capacity is `UNKNOWN`, `CONSTRAINED`, or `FULL` unless a future action family has explicit doctrine permitting a non-demand-increasing response.

For example, a constrained contractor could still justify a quote-follow-up or close-rate improvement action that does not intentionally create more top-of-funnel demand.

## Non-goals

This layer does not:

- decide marketing strategy;
- estimate staffing needs;
- forecast demand;
- create calendar capacity;
- infer capacity from vanity marketing metrics;
- replace Wiserr operational truth.

It answers one narrow question with evidence:

> Does the business currently have certified headroom for this scope, or should GrowthOS restrain demand?
