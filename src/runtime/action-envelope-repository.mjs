import { sha256Canonical } from '../core/canonical.mjs';
import {
  createDraftEnvelope,
  evaluateEnvelopeActivation,
  activateEnvelope,
  createReplacementDraft,
  revokeEnvelope,
  expireEnvelope,
  autonomyDelegationHash,
  validateAutonomyDelegation
} from '../core/envelope-lifecycle.mjs';
import { validateActionEnvelope } from '../core/validators.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const ACTION_ENVELOPE_RECORD_TYPE = 'action_envelope';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

export function actionEnvelopeRecoveryIndex({ delegateSubjectId, actionFamily }) {
  requiredString(delegateSubjectId, 'delegateSubjectId');
  requiredString(actionFamily, 'actionFamily');
  return sha256Canonical({ delegateSubjectId, actionFamily });
}

function validateEnvelopePayload(envelope) {
  validateActionEnvelope(envelope);
  requiredString(envelope.delegateSubjectId, 'envelope.delegateSubjectId');
  return envelope;
}

function expectedIndex(envelope) {
  return actionEnvelopeRecoveryIndex({
    delegateSubjectId: envelope.delegateSubjectId,
    actionFamily: envelope.actionFamily
  });
}

function validateEnvelopeRecord(record, tenantId) {
  validateEnvelopePayload(record.payload);
  if (
    record.tenantId !== tenantId ||
    record.payload.tenantId !== tenantId ||
    record.recordId !== record.payload.envelopeId ||
    record.indexKey !== expectedIndex(record.payload)
  ) {
    throw new Error('DURABLE_ACTION_ENVELOPE_IDENTITY_MISMATCH');
  }
  return record;
}

function eventIdFor(envelope, revision) {
  return `action-envelope:${envelope.envelopeId}:revision:${revision}:${envelope.status}`;
}

function eventTypeFor(envelope) {
  return `growth.action_envelope.${String(envelope.status).toLowerCase()}`;
}

function eventPayload(envelope, extra = {}) {
  return {
    envelopeId: envelope.envelopeId,
    delegateSubjectId: envelope.delegateSubjectId,
    actionFamily: envelope.actionFamily,
    autonomyLevel: envelope.autonomyLevel,
    status: envelope.status,
    authorityAssertionId: envelope.authorityAssertionId ?? null,
    authorityAssertionHash: envelope.authorityAssertionHash ?? null,
    replacesEnvelopeId: envelope.replacesEnvelopeId ?? null,
    ...clone(extra)
  };
}

export async function loadDurableActionEnvelope({ store, tenantId, envelopeId }) {
  requiredString(tenantId, 'tenantId');
  requiredString(envelopeId, 'envelopeId');
  const record = await store.getRecord({
    tenantId,
    recordType: ACTION_ENVELOPE_RECORD_TYPE,
    recordId: envelopeId
  });
  if (!record) return null;
  return validateEnvelopeRecord(record, tenantId);
}

export async function listDurableActionEnvelopes({ store, tenantId, delegateSubjectId, actionFamily, limit = 1000 }) {
  requiredString(tenantId, 'tenantId');
  const indexKey = actionEnvelopeRecoveryIndex({ delegateSubjectId, actionFamily });
  const records = await store.listRecords({
    tenantId,
    recordType: ACTION_ENVELOPE_RECORD_TYPE,
    indexKey,
    limit
  });
  return records.map(record => validateEnvelopeRecord(record, tenantId));
}

export async function createDurableDraftEnvelope({ store, input, now = new Date() }) {
  const envelope = input?.status === 'DRAFT' ? validateEnvelopePayload(clone(input)) : createDraftEnvelope(input);
  const existing = await loadDurableActionEnvelope({
    store,
    tenantId: envelope.tenantId,
    envelopeId: envelope.envelopeId
  });
  if (existing) {
    if (sha256Canonical(existing.payload) !== sha256Canonical(envelope)) {
      throw new Error('DURABLE_ACTION_ENVELOPE_ID_CONFLICT');
    }
    return { record: existing, idempotent: true };
  }

  const result = await mutateAuthoritativeRuntimeState({
    store,
    tenantId: envelope.tenantId,
    recordType: ACTION_ENVELOPE_RECORD_TYPE,
    recordId: envelope.envelopeId,
    indexKey: expectedIndex(envelope),
    payload: envelope,
    expectedRevision: 0,
    now,
    event: {
      eventId: eventIdFor(envelope, 1),
      eventType: eventTypeFor(envelope),
      payload: eventPayload(envelope),
      correlationId: envelope.envelopeId
    }
  });
  return { record: validateEnvelopeRecord(result.record, envelope.tenantId), idempotent: false };
}

async function transition({ store, tenantId, envelopeId, now = new Date(), apply, eventExtra = {} }) {
  const current = await loadDurableActionEnvelope({ store, tenantId, envelopeId });
  if (!current) throw new Error('DURABLE_ACTION_ENVELOPE_NOT_FOUND');
  const next = apply(clone(current.payload));
  validateEnvelopePayload(next);
  if (
    next.envelopeId !== current.payload.envelopeId ||
    next.tenantId !== current.payload.tenantId ||
    next.delegateSubjectId !== current.payload.delegateSubjectId ||
    next.actionFamily !== current.payload.actionFamily
  ) {
    throw new Error('DURABLE_ACTION_ENVELOPE_IDENTITY_CHANGED');
  }
  const revision = current.revision + 1;
  const result = await mutateAuthoritativeRuntimeState({
    store,
    tenantId,
    recordType: ACTION_ENVELOPE_RECORD_TYPE,
    recordId: envelopeId,
    indexKey: expectedIndex(next),
    payload: next,
    expectedRevision: current.revision,
    now,
    event: {
      eventId: eventIdFor(next, revision),
      eventType: eventTypeFor(next),
      payload: eventPayload(next, eventExtra),
      correlationId: envelopeId
    }
  });
  return validateEnvelopeRecord(result.record, tenantId);
}

export function activateDurableActionEnvelope({ store, tenantId, envelopeId, assertion, actorId, now = new Date() }) {
  validateAutonomyDelegation(assertion);
  return transition({
    store,
    tenantId,
    envelopeId,
    now,
    apply: envelope => activateEnvelope({ envelope, assertion, actorId, now }),
    eventExtra: {
      grantingActorId: actorId,
      issuerSystem: assertion.issuerSystem,
      issuerAuthorityRef: assertion.issuerAuthorityRef,
      assertionId: assertion.assertionId,
      assertionHash: autonomyDelegationHash(assertion)
    }
  });
}

export function revokeDurableActionEnvelope({ store, tenantId, envelopeId, assertion, actorId, reason, now = new Date() }) {
  validateAutonomyDelegation(assertion);
  return transition({
    store,
    tenantId,
    envelopeId,
    now,
    apply: envelope => revokeEnvelope({ envelope, assertion, actorId, reason, now }),
    eventExtra: {
      revocationReason: reason,
      grantingActorId: actorId,
      assertionId: assertion.assertionId,
      assertionHash: autonomyDelegationHash(assertion)
    }
  });
}

export function expireDurableActionEnvelope({ store, tenantId, envelopeId, now = new Date() }) {
  return transition({
    store,
    tenantId,
    envelopeId,
    now,
    apply: envelope => expireEnvelope(envelope, now),
    eventExtra: { expirationDerivedFromValidUntil: true }
  });
}

export async function replaceDurableActionEnvelope({
  store,
  tenantId,
  activeEnvelopeId,
  replacementEnvelopeId,
  changes = {},
  assertion,
  actorId,
  now = new Date()
}) {
  validateAutonomyDelegation(assertion);
  const activeRecord = await loadDurableActionEnvelope({ store, tenantId, envelopeId: activeEnvelopeId });
  if (!activeRecord) throw new Error('DURABLE_ACTION_ENVELOPE_NOT_FOUND');
  if (activeRecord.payload.status !== 'ACTIVE') throw new Error('DURABLE_REPLACEMENT_REQUIRES_ACTIVE_ENVELOPE');

  const replacementDraft = createReplacementDraft(activeRecord.payload, {
    envelopeId: replacementEnvelopeId,
    changes
  });
  const verdict = evaluateEnvelopeActivation({ envelope: replacementDraft, assertion, actorId, now });
  if (verdict.decision !== 'ALLOW') {
    throw new Error(`DURABLE_REPLACEMENT_ACTIVATION_DENIED:${verdict.reasons.join(',')}`);
  }

  const created = await createDurableDraftEnvelope({ store, input: replacementDraft, now });
  if (created.record.payload.replacesEnvelopeId !== activeEnvelopeId) {
    throw new Error('DURABLE_REPLACEMENT_LINEAGE_MISMATCH');
  }

  const revoked = await revokeDurableActionEnvelope({
    store,
    tenantId,
    envelopeId: activeEnvelopeId,
    assertion,
    actorId,
    reason: `replaced_by:${replacementEnvelopeId}`,
    now
  });

  try {
    const replacement = await activateDurableActionEnvelope({
      store,
      tenantId,
      envelopeId: replacementEnvelopeId,
      assertion,
      actorId,
      now
    });
    return { previous: revoked, replacement, resumed: created.idempotent };
  } catch (error) {
    error.safeReplacementState = {
      previousEnvelopeId: activeEnvelopeId,
      previousStatus: 'REVOKED',
      replacementEnvelopeId,
      replacementStatus: 'DRAFT'
    };
    throw error;
  }
}
