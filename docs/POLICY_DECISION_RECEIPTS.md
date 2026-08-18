# Policy Decision Receipts

GrowthOS control-plane decisions must be auditable without logging private campaign content.

Every consequential policy evaluation should be able to produce an immutable receipt answering:

- which tenant/action was evaluated;
- which policy envelope authorized or refused it;
- what exact action hash was evaluated;
- what exact envelope authority hash was evaluated;
- whether the decision was `ALLOW`, `REQUIRE_APPROVAL`, `DENY`, or `NO_ACTION`;
- why;
- when;
- under which autonomy level.

## Privacy boundary

The receipt does **not** persist full action inputs such as:

- message copy;
- private strategy notes;
- customer details;
- recipient lists;
- prompts;
- arbitrary provider payloads.

Instead, the exact action is SHA-256 bound while the human-readable summary contains only bounded operational metadata:

- action family/type;
- channel;
- external account identifier;
- geography;
- expected spend;
- expected recipient count.

The same rule applies to envelope notes. Notes do not alter the authority hash and are not copied into the receipt.

## Tamper evidence

A receipt contains:

```text
actionHash
+ envelopeHash
+ decision
+ reasons
+ evaluatedAt
+ bounded summary
        ↓
receiptHash
```

Changing a receipt after creation invalidates `receiptHash`.

Changing the action or authority envelope after evaluation invalidates the match between the receipt and current execution inputs.

## Authority hash

The envelope authority hash includes fields that change execution permission:

- tenant;
- action family;
- autonomy level;
- status and validity window;
- allowed channels/accounts/geographies;
- spend/recipient/change/attempt limits;
- approval requirement and bound approval identity/hash;
- policy version.

Non-authority operator notes are intentionally excluded.

## Growth event projection

A receipt can be projected to:

```text
growth.policy.decision
```

with:

```text
executionCertainty = NOT_APPLICABLE
attributionConfidence = NOT_APPLICABLE
```

Policy decisions are authority evidence, not business outcomes.

## Relationship to other controls

```text
opportunity / campaign
        ↓
exact action
        ↓
control-plane evaluation
        ↓
POLICY DECISION RECEIPT
        ↓
if ALLOW
        ↓
execution-attempt ledger
        ↓
external side effect
        ↓
growth outcome ledger
```

A policy receipt does not prove an action executed. The execution-attempt ledger owns that truth.

Likewise, an execution receipt does not prove business impact. The Growth Event / Outcome Ledger owns downstream outcome evidence and attribution confidence.

## Principle

> GrowthOS should be able to explain every important action it took, every important action it refused, and the exact authority state that produced that decision—without turning logs into a second copy of private customer or campaign data.
