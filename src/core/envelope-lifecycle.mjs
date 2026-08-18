import { sha256Canonical } from './canonical.mjs';
import { AUTONOMY_LEVELS, validateActionEnvelope } from './validators.mjs';

const ASSERTION_STATES = new Set(['ACTIVE', 'REVOKED', 'EXPIRED']);
const ENVELOPE_TERMINAL = new Set(['REVOKED', 'EXPIRED']);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function iso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date/time.`);
  return date.toISOString();
}

function uniqueStrings(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw new Error(`${label} must be an array${allowEmpty ? '' : ' with at least one value'}.`);
  const normalized = value.map((item) => requiredString(item, `${label} item`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates.`);
  return normalized;
}

function ceilingAllows(ceiling, requested) {
  if (ceiling === 'UNBOUNDED') return true;
  if (requested === null || requested === undefined) return false;
  return requested <= ceiling;
}

function scopeAllows(allowed, requested) {
  if (!Array.isArray(requested) || requested.length === 0) return true;
  return requested.every((item) => allowed.includes(item));
}

export function validateAutonomyDelegation(assertion) {
  if (!assertion || typeof assertion !== 'object' || Array.isArray(assertion)) throw new Error('assertion must be an object.');
  if (assertion.schemaVersion !== 1) throw new Error('Unsupported assertion schemaVersion.');
  requiredString(assertion.assertionId, 'assertion.assertionId');
  requiredString(assertion.tenantId, 'assertion.tenantId');
  requiredString(assertion.grantingActorId, 'assertion.grantingActorId');
  requiredString(assertion.issuerSystem, 'assertion.issuerSystem');
  requiredString(assertion.issuerAuthorityRef, 'assertion.issuerAuthorityRef');
  if (!ASSERTION_STATES.has(assertion.status)) throw new Error('Invalid assertion.status.');
  const from = Date.parse(iso(assertion.validFrom, 'assertion.validFrom'));
  const until = Date.parse(iso(assertion.validUntil, 'assertion.validUntil'));
  if (until <= from) throw new Error('assertion.validUntil must be after validFrom.');
  uniqueStrings(assertion.allowedDelegateSubjectIds, 'assertion.allowedDelegateSubjectIds');
  uniqueStrings(assertion.actionFamilies, 'assertion.actionFamilies');
  const levels = uniqueStrings(assertion.allowedAutonomyLevels, 'assertion.allowedAutonomyLevels');
  if (levels.some((level) => !AUTONOMY_LEVELS.includes(level))) throw new Error('assertion.allowedAutonomyLevels contains an invalid level.');
  if (!assertion.scopes || typeof assertion.scopes !== 'object') throw new Error('assertion.scopes is required.');
  uniqueStrings(assertion.scopes.channels, 'assertion.scopes.channels');
  uniqueStrings(assertion.scopes.accountIds, 'assertion.scopes.accountIds');
  uniqueStrings(assertion.scopes.geographies, 'assertion.scopes.geographies');
  if (!assertion.limitCeilings || typeof assertion.limitCeilings !== 'object') throw new Error('assertion.limitCeilings is required.');
  if (!Number.isInteger(assertion.limitCeilings.maxAttempts) || assertion.limitCeilings.maxAttempts < 1) throw new Error('assertion.limitCeilings.maxAttempts must be positive.');
  if (typeof assertion.canActivateEnvelopes !== 'boolean' || typeof assertion.canRevokeEnvelopes !== 'boolean') throw new Error('assertion activation/revocation permissions must be boolean.');
  return assertion;
}

export function autonomyDelegationHash(assertion) {
  validateAutonomyDelegation(assertion);
  return sha256Canonical({
    schemaVersion: assertion.schemaVersion,
    assertionId: assertion.assertionId,
    tenantId: assertion.tenantId,
    grantingActorId: assertion.grantingActorId,
    issuerSystem: assertion.issuerSystem,
    issuerAuthorityRef: assertion.issuerAuthorityRef,
    status: assertion.status,
    validFrom: assertion.validFrom,
    validUntil: assertion.validUntil,
    allowedDelegateSubjectIds: assertion.allowedDelegateSubjectIds,
    actionFamilies: assertion.actionFamilies,
    allowedAutonomyLevels: assertion.allowedAutonomyLevels,
    scopes: assertion.scopes,
    limitCeilings: assertion.limitCeilings,
    canActivateEnvelopes: assertion.canActivateEnvelopes,
    canRevokeEnvelopes: assertion.canRevokeEnvelopes,
    evidenceRef: assertion.evidenceRef ?? null
  });
}

export function createDraftEnvelope(input) {
  const envelope = {
    schemaVersion: 1,
    envelopeId: requiredString(input.envelopeId, 'envelopeId'),
    tenantId: requiredString(input.tenantId, 'tenantId'),
    actionFamily: requiredString(input.actionFamily, 'actionFamily'),
    delegateSubjectId: requiredString(input.delegateSubjectId, 'delegateSubjectId'),
    autonomyLevel: input.autonomyLevel,
    status: 'DRAFT',
    validFrom: iso(input.validFrom, 'validFrom'),
    validUntil: iso(input.validUntil, 'validUntil'),
    channels: uniqueStrings(input.channels ?? [], 'channels', { allowEmpty: true }),
    accountIds: uniqueStrings(input.accountIds ?? [], 'accountIds', { allowEmpty: true }),
    geographies: uniqueStrings(input.geographies ?? [], 'geographies', { allowEmpty: true }),
    limits: structuredClone(input.limits),
    requiresApproval: input.requiresApproval === true,
    approvalId: input.approvalId ?? null,
    approvedActionHash: input.approvedActionHash ?? null,
    policyVersion: input.policyVersion ?? 'v1',
    authorityAssertionId: null,
    authorityAssertionHash: null,
    activatedAt: null,
    activatedBy: null,
    replacesEnvelopeId: input.replacesEnvelopeId ?? null,
    notes: input.notes ?? ''
  };
  if (!AUTONOMY_LEVELS.includes(envelope.autonomyLevel)) throw new Error('Invalid autonomyLevel.');
  validateActionEnvelope(envelope);
  return envelope;
}

export function evaluateEnvelopeActivation({ envelope, assertion, actorId, now = new Date() }) {
  validateActionEnvelope(envelope);
  validateAutonomyDelegation(assertion);
  const reasons = [];
  const nowMs = Date.parse(iso(now, 'now'));

  if (envelope.status !== 'DRAFT') reasons.push('ENVELOPE_NOT_DRAFT');
  if (assertion.status !== 'ACTIVE') reasons.push(`DELEGATION_${assertion.status}`);
  if (nowMs < Date.parse(assertion.validFrom) || nowMs > Date.parse(assertion.validUntil)) reasons.push('DELEGATION_NOT_CURRENT');
  if (!assertion.canActivateEnvelopes) reasons.push('DELEGATION_CANNOT_ACTIVATE');
  if (actorId !== assertion.grantingActorId) reasons.push('GRANTING_ACTOR_MISMATCH');
  if (envelope.tenantId !== assertion.tenantId) reasons.push('TENANT_MISMATCH');
  if (!assertion.allowedDelegateSubjectIds.includes(envelope.delegateSubjectId)) reasons.push('DELEGATE_SUBJECT_NOT_AUTHORIZED');
  if (!assertion.actionFamilies.includes(envelope.actionFamily)) reasons.push('ACTION_FAMILY_NOT_DELEGATED');
  if (!assertion.allowedAutonomyLevels.includes(envelope.autonomyLevel)) reasons.push('AUTONOMY_LEVEL_NOT_DELEGATED');
  if (!scopeAllows(assertion.scopes.channels, envelope.channels)) reasons.push('CHANNEL_SCOPE_EXCEEDED');
  if (!scopeAllows(assertion.scopes.accountIds, envelope.accountIds)) reasons.push('ACCOUNT_SCOPE_EXCEEDED');
  if (!scopeAllows(assertion.scopes.geographies, envelope.geographies)) reasons.push('GEOGRAPHY_SCOPE_EXCEEDED');
  if (envelope.limits.maxAttempts > assertion.limitCeilings.maxAttempts) reasons.push('ATTEMPT_CEILING_EXCEEDED');
  if (!ceilingAllows(assertion.limitCeilings.maxSpendUsdPerDay, envelope.limits.maxSpendUsdPerDay)) reasons.push('DAILY_SPEND_CEILING_EXCEEDED');
  if (!ceilingAllows(assertion.limitCeilings.maxSpendUsdTotal, envelope.limits.maxSpendUsdTotal)) reasons.push('TOTAL_SPEND_CEILING_EXCEEDED');
  if (!ceilingAllows(assertion.limitCeilings.maxChangePercent, envelope.limits.maxChangePercent)) reasons.push('CHANGE_CEILING_EXCEEDED');
  if (!ceilingAllows(assertion.limitCeilings.maxRecipients, envelope.limits.maxRecipients)) reasons.push('RECIPIENT_CEILING_EXCEEDED');
  if (Date.parse(envelope.validFrom) < Date.parse(assertion.validFrom) || Date.parse(envelope.validUntil) > Date.parse(assertion.validUntil)) reasons.push('ENVELOPE_VALIDITY_EXCEEDS_DELEGATION');

  return { decision: reasons.length ? 'DENY' : 'ALLOW', reasons: reasons.length ? reasons : ['ENVELOPE_WITHIN_DELEGATED_AUTHORITY'] };
}

export function activateEnvelope({ envelope, assertion, actorId, now = new Date() }) {
  const verdict = evaluateEnvelopeActivation({ envelope, assertion, actorId, now });
  if (verdict.decision !== 'ALLOW') throw new Error(`ENVELOPE_ACTIVATION_DENIED:${verdict.reasons.join(',')}`);
  return {
    ...structuredClone(envelope),
    status: 'ACTIVE',
    authorityAssertionId: assertion.assertionId,
    authorityAssertionHash: autonomyDelegationHash(assertion),
    activatedAt: iso(now, 'now'),
    activatedBy: actorId
  };
}

export function assertActiveEnvelopeImmutable(previous, proposed) {
  validateActionEnvelope(previous);
  validateActionEnvelope(proposed);
  if (previous.status !== 'ACTIVE') throw new Error('IMMUTABILITY_REQUIRES_ACTIVE_ENVELOPE');
  if (sha256Canonical(previous) !== sha256Canonical(proposed)) throw new Error('ACTIVE_ENVELOPE_IMMUTABLE');
  return true;
}

export function createReplacementDraft(activeEnvelope, { envelopeId, changes = {} }) {
  validateActionEnvelope(activeEnvelope);
  if (activeEnvelope.status !== 'ACTIVE') throw new Error('REPLACEMENT_REQUIRES_ACTIVE_ENVELOPE');
  const candidate = {
    ...structuredClone(activeEnvelope),
    ...structuredClone(changes),
    limits: changes.limits ? structuredClone(changes.limits) : structuredClone(activeEnvelope.limits),
    envelopeId: requiredString(envelopeId, 'envelopeId'),
    status: 'DRAFT',
    authorityAssertionId: null,
    authorityAssertionHash: null,
    activatedAt: null,
    activatedBy: null,
    replacesEnvelopeId: activeEnvelope.envelopeId
  };
  validateActionEnvelope(candidate);
  return candidate;
}

export function activateReplacement({ activeEnvelope, replacementDraft, assertion, actorId, now = new Date() }) {
  if (replacementDraft.replacesEnvelopeId !== activeEnvelope.envelopeId) throw new Error('REPLACEMENT_LINEAGE_MISMATCH');
  const replacement = activateEnvelope({ envelope: replacementDraft, assertion, actorId, now });
  const previous = revokeEnvelope({ envelope: activeEnvelope, assertion, actorId, now, reason: `replaced_by:${replacement.envelopeId}` });
  return { previous, replacement };
}

export function revokeEnvelope({ envelope, assertion, actorId, now = new Date(), reason }) {
  validateActionEnvelope(envelope);
  validateAutonomyDelegation(assertion);
  requiredString(reason, 'reason');
  if (ENVELOPE_TERMINAL.has(envelope.status)) throw new Error('ENVELOPE_ALREADY_TERMINAL');
  if (assertion.status !== 'ACTIVE' || !assertion.canRevokeEnvelopes) throw new Error('DELEGATION_CANNOT_REVOKE');
  if (assertion.tenantId !== envelope.tenantId || actorId !== assertion.grantingActorId) throw new Error('REVOCATION_AUTHORITY_MISMATCH');
  return { ...structuredClone(envelope), status: 'REVOKED', revokedAt: iso(now, 'now'), revokedBy: actorId, revocationReason: reason };
}

export function expireEnvelope(envelope, now = new Date()) {
  validateActionEnvelope(envelope);
  const nowIso = iso(now, 'now');
  if (Date.parse(nowIso) <= Date.parse(envelope.validUntil)) throw new Error('ENVELOPE_NOT_EXPIRED_YET');
  if (envelope.status === 'REVOKED') return structuredClone(envelope);
  return { ...structuredClone(envelope), status: 'EXPIRED', expiredAt: nowIso };
}

export function envelopeLifecycleReceipt({ eventType, before = null, after, actorId, assertion = null, occurredAt = new Date() }) {
  if (!['CREATED', 'ACTIVATED', 'REVOKED', 'REPLACED', 'EXPIRED'].includes(eventType)) throw new Error('Invalid lifecycle eventType.');
  validateActionEnvelope(after);
  if (before) validateActionEnvelope(before);
  const body = {
    schemaVersion: 1,
    eventType,
    envelopeId: after.envelopeId,
    tenantId: after.tenantId,
    delegateSubjectId: after.delegateSubjectId ?? null,
    beforeHash: before ? sha256Canonical(before) : null,
    afterHash: sha256Canonical(after),
    actorId: actorId ?? null,
    assertionId: assertion?.assertionId ?? null,
    assertionHash: assertion ? autonomyDelegationHash(assertion) : null,
    occurredAt: iso(occurredAt, 'occurredAt')
  };
  return { ...body, receiptHash: sha256Canonical(body) };
}
