# Capacity Source Authority

## Problem

The capacity engine accepts evidence records containing signals such as:

```text
AVAILABLE
CONSTRAINED
FULL
```

and each signal carries an `authoritative` boolean.

That boolean is an internal fact marker, not proof that the source was allowed to make the claim. Without a separate authority layer, an adapter could accidentally—or maliciously—set `authoritative: true` and turn incomplete input into permission to increase demand.

## Rule

> An authoritative capacity signal is usable only when the source itself has current tenant-scoped authority for that verdict and scope.

`capacity-source-authority` is therefore separate from `capacity-evidence`.

## Authority assertion

A capacity source authority binds:

- tenant;
- source system;
- source authority identity;
- allowed scope keys;
- validity window;
- whether the source may assert `AVAILABLE`;
- whether the source may assert `CONSTRAINED` / `FULL`;
- an external evidence reference proving where that authority came from.

GrowthOS does not decide who is an owner, scheduler authority, job-system authority, or booking authority. The upstream operating system must supply that proof.

## Permission asymmetry

A source may be permitted to throttle growth without being trusted to create headroom.

For example:

```text
canAssertAvailability = false
canAssertConstraints = true
```

Such a source may safely report `CONSTRAINED` or `FULL`, but an `AVAILABLE` signal from it produces `UNKNOWN` + demand throttle rather than permission to acquire more customers.

This is deliberate. False positive headroom is more dangerous than a conservative delay in acquisition.

## Validity coupling

Capacity evidence must:

- be created inside the authority's validity window;
- not claim a validity window longer than its issuer's authority;
- match tenant;
- match exact source system/authority;
- match an allowed scope key.

Revoked, expired, cross-tenant, cross-source, or out-of-scope authority fails closed.

## Owner-attested pilot capacity

This contract makes a future owner-attested pilot path possible without weakening the core.

The safe shape would be:

```text
Wiserr verifies owner/admin tenant authority
        ↓
short-lived capacity-source authority
        ↓
scoped owner attestation
        ↓
capacity evidence
        ↓
deriveCapacityStateWithAuthority()
```

GrowthOS must not accept a raw UI checkbox or arbitrary API payload as `authoritative: true`.

Owner attestation should remain distinguishable from stronger operational sources such as job backlog, appointment utilization, crew availability, or vertical scheduling systems.

## Production requirement

Any path that can change capacity from `UNKNOWN` to `AVAILABLE` for a demand-increasing GrowthOS action must use `deriveCapacityStateWithAuthority()` or an equivalent certified wrapper, not the raw evidence derivation primitive alone.
