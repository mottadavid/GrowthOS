# System Boundaries

This document prevents GrowthOS from becoming a second Wiserr or absorbing AI Studio.

## Ownership matrix

| Domain | Canonical owner | GrowthOS role |
|---|---|---|
| Tenant identity | Wiserr OS | consume scoped identity |
| Users/permissions | Wiserr OS | enforce delegated authority |
| Contacts/customers/leads | Wiserr OS | read/segment/reference |
| Conversations/inbox | Wiserr OS | trigger/observe growth workflows |
| Appointments/jobs | Wiserr OS | consume outcomes/capacity |
| CRM/pipeline | Wiserr OS | consume/update only through contracts |
| Business operational capacity | Wiserr OS | use as growth constraint |
| Luna | Wiserr OS | request conversational execution/handoff |
| Growth goals | GrowthOS | canonical |
| Growth opportunities | GrowthOS | canonical |
| Strategy/action portfolio | GrowthOS | canonical |
| Marketing action envelopes | GrowthOS | canonical |
| Growth experiments | GrowthOS | canonical |
| Channel campaign references | GrowthOS | canonical orchestration metadata; platform remains execution authority |
| Marketing attribution | GrowthOS | canonical derived model with source links |
| Growth learning | GrowthOS | canonical |
| Human Content Farm | AI Studio | request/consume approved creative intelligence |
| Brand Character Intelligence | AI Studio | request/consume |
| Viral Format Discovery | AI Studio | request/consume |
| Creative production/QC | AI Studio | request/consume |
| Provider identity/voice/video assets | AI Studio | reference only |

## Wiserr boundary

GrowthOS must never create its own competing:
- user directory
- tenant authority
- contact/customer master
- appointment/job master
- CRM/pipeline truth
- Luna identity/permission model
- invoice/revenue truth

GrowthOS may maintain derived references and snapshots for reproducibility, but those records must identify source system, source ID/version/time, and freshness.

## AI Studio boundary

GrowthOS should describe **creative intent**, not implement provider-specific creative production.

Example GrowthOS creative request:

```json
{
  "objective": "reactivate dormant estimate leads",
  "audience": "homeowners with unaccepted roof estimates",
  "message": "estimates expire / project planning prompt",
  "identityPreference": "brand-character-or-founder",
  "channel": "instagram-reel",
  "constraints": {
    "noFabricatedTestimonials": true,
    "maxDurationSec": 25
  }
}
```

AI Studio decides how approved content intelligence, identity, voice, format, and provider execution produce the artifact.

GrowthOS must not bypass AI Studio's creative truth, consent, provenance, spend, or QC controls.

## External channel boundary

GrowthOS owns orchestration and policy, not the external platform's source data.

Persist:
- external account/reference IDs
- exact action requested
- exact action accepted/executed
- external campaign/post/message IDs
- spend/budget state
- timestamps
- errors/outcome certainty

Do not assume an API timeout means an action failed. Ambiguous remote outcomes require reconciliation where duplicate execution could matter.

## Product boundary

The initial user experience may be internal/operator-first. Do not build a broad standalone SaaS dashboard merely because GrowthOS is a separate service.

Strategically, the intended front door is Wiserr/Luna.

## Repository boundary

GrowthOS repository contains:
- code
- schemas
- control-plane policies/defaults
- contracts
- tests
- generic examples
- architecture/doctrine

It must not contain:
- tenant credentials
- raw client databases
- private customer exports
- ad-account secrets/tokens
- raw private creative media
- AI Studio generated/source media

Private runtime data belongs in managed transactional/object storage when production execution begins.
