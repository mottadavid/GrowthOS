# Growth Run Manifest

A Growth Run Manifest is the privacy-safe identity spine for one governed growth action.

It does not replace the source objects. It proves that the source objects participating in a run are mutually consistent.

## Why it exists

GrowthOS now has separate authorities for:

- business state
- opportunity detection
- campaign planning and approval
- experiments
- autonomy delegation
- policy decisions
- execution attempts
- business outcomes

Those authorities must remain separate, but a production run also needs deterministic proof that they all refer to the **same tenant, evidence snapshot, approved plan, experiment, authority envelope, action, execution attempt, and outcomes**.

Without that spine, individually valid records could be accidentally or maliciously mixed across runs.

## Manifest chain

```text
Wiserr business snapshot
        ↓
opportunity
        ↓
approved campaign / plan hash
        ↓
approved experiment / action-plan hash
        ↓
active delegated action envelope
        ↓
exact policy action + policy receipt
        ↓
execution attempt
        ↓
canonical business outcome events
        ↓
Growth Run Manifest
```

## Privacy boundary

The manifest stores only identifiers, hashes, authority references, attempt state, and outcome event IDs.

It does **not** store:

- message body
- customer names or contact information
- story/content material
- private operator notes
- provider payloads

Those remain in their owning authorities.

## Required production evidence

A run manifest requires:

- approved campaign and exact plan hash
- approved experiment and external experiment-approval authority reference
- active action envelope with external authority assertion ID/hash
- exact action hash
- exact policy decision receipt
- execution attempt tied to the same exact action

The manifest refuses tenant, snapshot, opportunity, plan, experiment, delegate, action, attempt, or policy-receipt drift.

## Outcome rule

A manifest may be created while an execution attempt is still in progress **only when no business outcomes are attached yet**.

Once the manifest includes `growth.business_outcome.observed` events, the execution attempt must be:

- `COMPLETED`, or
- `RECONCILED_COMPLETED`.

An accepted-but-unresolved execution cannot be presented alongside downstream outcomes as a completed causal chain.

This is an identity/provenance rule, not a causal-attribution claim. Outcome attribution confidence remains owned by the outcome ledger.

## Reactivation policy action bridge

The first closed loop uses a canonical GrowthOS `ActionRequest` derived from the approved reactivation plan.

The policy action contains IDs and hashes rather than private message text. It binds:

- plan ID and approval hash
- campaign approval ID
- cohort definition/version
- message version and message hash
- experiment ID
- expected recipient/spend exposure

### L3 one-action envelope

For the first reactivation loop, `L3_APPROVAL_REQUIRED` uses a narrow envelope whose `approvedActionHash` binds one exact action. This is deliberate.

A future reusable `L4_BOUNDED_AUTONOMOUS` envelope may authorize a family of actions inside a bounded policy, but that must be earned separately and must never be inferred from an L3 approval.

## Tamper detection

The manifest is hash-protected. A retained manifest can also be rechecked against the current source objects with `assertGrowthRunManifestMatches`.

Source mutation is rejected at the earliest valid authority boundary. For example, changing an action may first invalidate the execution attempt or policy receipt before the final manifest comparison is reached. That is correct fail-closed behavior.
