# GrowthOS ↔ AI Studio Integration Contract

## Purpose

GrowthOS owns the **growth objective and campaign intent**. AI Studio owns **creative intelligence, identity/voice provenance, creative production, provider execution, and creative QC**.

The boundary should remain stable even if creative providers change.

## GrowthOS sends creative intent

A future creative request should contain business/growth intent, not provider commands.

Conceptual fields:

```text
tenant/client reference
campaign/opportunity reference
objective
audience
channel / placement
content mode
message / offer constraints
brand constraints
identity preference
required CTA
factual authority/source references
format constraints
language
quantity/variant policy
budget/resource envelope reference
required due time
```

Content modes may include:
- real-human source-backed content
- original synthetic brand-character content
- licensed/provider-presenter content
- non-avatar creative

GrowthOS must not fabricate a human biography to satisfy a creative brief.

## AI Studio returns production objects

At minimum:

```text
creativeJobId
creative status
identity profile/version
content intelligence references
format references
artifact references
creative QC
provider/provenance metadata
cost/provider-unit metadata
approval/review status
```

GrowthOS generally cares about the approved artifact and its lineage, not the provider-specific generation internals.

## Approval separation

There may be multiple independent approvals:

1. **Growth action approval** — GrowthOS authority to run campaign/action.
2. **Creative spend approval** — AI Studio provider generation authority.
3. **Creative/content approval** — brand/client approval of exact artifact.
4. **Paid media spend approval** — GrowthOS authority for distribution spend.

Do not collapse these into one boolean.

## Identity and content authority

AI Studio should expose whether creative identity is:
- authorized human
- original synthetic
- licensed/provider identity

and the relevant provenance/authorization status.

GrowthOS may select among eligible identity classes based on strategy, but cannot bypass AI Studio's provenance gate.

## Creative performance feedback

GrowthOS should send outcome data back to AI Studio so creative learning can connect:
- story/content source type
- identity
- hook/format
- creative artifact
- platform/placement
- retention/engagement
- lead/business outcome

AI Studio owns creative-level learning; GrowthOS owns broader growth/campaign learning.

## Failure semantics

Creative generation failure must not automatically classify the campaign idea as a failed market hypothesis.

Classify:
- creative unavailable
- provider unavailable
- creative QC failed
- approval rejected
- distribution failed
- market/customer response weak

## First integration slice

The first GrowthOS vertical slice may use simple text/message creative and not require AI Studio. This is intentional: prove the control/outcome loop before coupling the creative production service.

AI Studio becomes central when GrowthOS expands into organic content, paid social creative, synthetic brand characters, and multi-format campaigns.
