# Wiserr Reactivation SMS Execution Authority

GrowthOS treats Wiserr business-state reads and Wiserr SMS execution as separate upstream authorities.

A certified `wiserr-growth-snapshot-v1` read capability can never authorize an SMS send. The reactivation command requires a separate `wiserr-reactivation-sms-v1` execution authority decision.

## Current audited state

Wiserr already has a strong canonical SMS runtime:

- `server/messaging/sendTenantSms.ts` is the canonical outbound SMS adapter;
- platform/tenant messaging kill switch runs before provider resolution;
- recipient opt-out lookup fails closed;
- tenant SMS program + linked-number compliance gate exists;
- shared-campaign purposes are allowlisted;
- per-tenant rate limiting exists;
- production simulation is refused;
- provider orchestration propagates correlation/idempotency identity;
- ambiguous provider outcomes stop fallback and require reconciliation.

Those facts prove transport and safety infrastructure. They do **not** prove dormant-lead marketing authority.

## Why execution remains disabled

The current Wiserr `SmsPurpose` vocabulary does not contain an explicit GrowthOS dormant-reactivation marketing purpose. Existing `follow_up` and `luna_sms` purposes must not be repurposed to bypass compliance review.

Wiserr's own SMS ADR says product-specific purposes may be added only after compliance review and shared-campaign allowlist review.

The shared platform campaign is currently described as `LOW_VOLUME_MIXED`, but that label alone is insufficient evidence that the actual registered use case, sample messages, and opt-in evidence cover dormant-lead marketing reactivation.

Therefore the checked-in upstream receipt is `OBSERVED` and:

```text
reactivationSmsExecution = false
```

## Certification requirements

The semantic basis cannot set `reactivationSmsExecution=true` unless all of these are proven:

1. Wiserr declares the canonical purpose `growth_reactivation`.
2. Compliance review status is `APPROVED`.
3. The purpose is approved on the applicable shared/dedicated campaign allowlist.
4. Carrier/program coverage is `VERIFIED` with retained evidence for:
   - registered use case;
   - sample messages;
   - opt-in/consent coverage.
5. The canonical safety path remains intact:
   - kill switch first;
   - opt-out fail closed;
   - tenant program gate;
   - final recipient eligibility inside Wiserr;
   - tenant rate limiting;
   - production no-simulation;
   - no direct provider bypass;
   - ambiguous outcomes require reconciliation.

## Command binding

A Wiserr reactivation command records:

- `executionAuthorityDependencyId = wiserr-reactivation-sms-v1`
- `executionAuthorityLockFingerprint`

Both are inside the command hash. A READY decision from any other dependency, including the snapshot read dependency, is rejected.

This prevents authority confusion as GrowthOS gains more upstream integrations.
