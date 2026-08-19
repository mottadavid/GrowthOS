# Wiserr transport orchestrator

## Purpose

The first real reactivation loop needs exactly one place where GrowthOS is allowed to cross from durable local authority into a Wiserr side effect.

`executePreparedWiserrReactivationSubmission()` composes the already-certified local primitives without weakening them:

1. revalidate runtime, capacity, and SMS execution authority;
2. load the exact persisted command;
3. move campaign to `EXECUTING` and attempt to `SUBMITTING` durably;
4. call the injected Wiserr transport exactly once;
5. require a canonical Wiserr submission-result contract;
6. durably ingest that result and advance campaign state.

## No blind retry

Once preparation reaches `SUBMITTING`, GrowthOS must assume Wiserr may have received the request.

If transport throws, times out, returns malformed evidence, or returns an identity-mismatched result, the orchestrator returns `WISERR_TRANSPORT_OUTCOME_REQUIRES_RECONCILIATION`.

It does not call transport again. The durable attempt remains unresolved and the existing recovery/reconciliation authorities own the next step.

A later caller attempting the same command is refused by the durable `SUBMITTING` replay guard before transport invocation.

## Transport contract

The injected transport receives the exact persisted command plus its stable idempotency key. It must return the canonical privacy-bounded Wiserr submission result defined by the result-ingestion contract.

GrowthOS does not accept arbitrary provider payloads, recipient data, or message echoes as result evidence.

## Authority boundary

This module does not itself certify Wiserr. It remains unusable for a real send until all upstream requirements are independently certified, including the GrowthOS-specific SMS purpose, compliance/carrier/consent coverage, canonical result classification, and ambiguity reconciliation contract.
