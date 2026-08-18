# GrowthOS Safety Doctrine

These are architecture invariants, not suggestions.

## 1. Tenant authority

Every read, decision, action, budget, credential reference, campaign, event, and outcome is tenant scoped.

Never trust tenant identifiers supplied by an untrusted caller without validating them against Wiserr authority.

## 2. Canonical business truth

GrowthOS does not become a competing CRM/operations database.

When Wiserr owns a domain, GrowthOS stores references/snapshots for reproducibility and reads current truth through explicit contracts.

## 3. Deterministic execution authority

LLMs/agents do not directly authorize consequential external actions.

The control plane must evaluate:
- actor/service authority
- action family
- autonomy level
- approval state
- budget
- channel/account
- offer/brand/compliance constraints
- capacity
- freshness
- attempt/retry policy

## 4. Spend safety

Never execute paid actions without a controlled spend dimension.

Never autonomously increase the approved total budget.

Track native platform/provider units separately from USD when conversion is uncertain. Do not invent false precision.

## 5. Retry and ambiguity safety

Unexpected network/API exceptions are not automatically definitive failures.

Where duplicate execution could create spend, publication, or customer-contact harm, ambiguous outcomes block blind retry until reconciled.

## 6. Customer-contact safety

Outbound actions require:
- valid audience/recipient authority
- approved channel/use case
- applicable opt-in/consent/compliance policy
- frequency/rate limits
- suppression/unsubscribe handling
- exact tenant isolation

Do not infer permission merely because a contact exists in CRM.

## 7. Offer/pricing safety

Agents may analyze and draft offers. Material pricing, discounts, guarantees, promises, or terms require explicit authority unless already covered by a narrow approved envelope.

## 8. Creative truth and identity safety

GrowthOS requests creative; AI Studio remains authority for creative provenance and production controls.

Human-source content must remain source backed. Synthetic brand characters must not silently claim fabricated firsthand human history or credentials.

## 9. Operational-capacity safety

Demand-generation decisions must consider fulfillment capacity when authoritative data is available.

The system must be able to recommend reducing/pausing acquisition rather than optimizing demand in isolation.

## 10. Measurement safety

Do not optimize only for vanity metrics.

Label metric classes explicitly:
- exposure
- engagement
- traffic
- lead
- qualified lead
- booking
- sale
- revenue
- retention
- business-capacity outcome

Do not claim causal learning from correlation without appropriate experimental evidence.

## 11. Experiment safety

Every material experiment should define:
- hypothesis
- treatment/change
- budget/resource cap
- success metric
- guardrails
- observation horizon
- stop condition

Do not run uncontrolled combinatorial variants.

## 12. Secrets/logging

Never commit:
- channel tokens
- ad-account credentials
- customer exports
- private tenant data
- raw secrets

Logs must not intentionally dump private customer content, access tokens, or full provider responses containing sensitive data.

## 13. Platform-policy drift

Advertising, social publishing, messaging, synthetic-media disclosure, and API policies change.

Adapters must treat current platform capability/policy as runtime/operational truth rather than permanently encoding assumptions from tutorials or old documentation.

## 14. Restraint doctrine

`NO_ACTION` is a successful outcome when intervention is unjustified.

Examples:
- sample too small
- measurement unreliable
- evidence conflicting
- capacity constrained
- campaign within expected noise
- action cost exceeds expected value

The system must not create activity merely to satisfy an agent loop.

## 15. Kill switch

Production design must include tenant/account/channel-level pause and envelope revocation.

A human operator must be able to stop new GrowthOS execution without depending on the agent that recommended the action.
