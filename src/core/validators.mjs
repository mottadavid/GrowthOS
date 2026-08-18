function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function finiteNonNegative(value, label, { nullable = false } = {}) {
  if (value === null && nullable) return value;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number${nullable ? ' or null' : ''}.`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function validDate(value, label) {
  requiredString(value, label);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label} must be a valid date-time.`);
  return ms;
}

export const AUTONOMY_LEVELS = Object.freeze([
  'L0_OBSERVE',
  'L1_RECOMMEND',
  'L2_DRAFT',
  'L3_APPROVAL_REQUIRED',
  'L4_BOUNDED_AUTONOMOUS',
  'L5_LOW_RISK_AUTONOMOUS'
]);

export function validateActionEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('envelope must be an object.');
  if (envelope.schemaVersion !== 1) throw new Error('Unsupported envelope schemaVersion.');
  requiredString(envelope.envelopeId, 'envelope.envelopeId');
  requiredString(envelope.tenantId, 'envelope.tenantId');
  requiredString(envelope.actionFamily, 'envelope.actionFamily');
  if (envelope.delegateSubjectId !== undefined && envelope.delegateSubjectId !== null) requiredString(envelope.delegateSubjectId, 'envelope.delegateSubjectId');
  if (!AUTONOMY_LEVELS.includes(envelope.autonomyLevel)) throw new Error('Invalid envelope.autonomyLevel.');
  if (!['DRAFT', 'ACTIVE', 'REVOKED', 'EXPIRED'].includes(envelope.status)) throw new Error('Invalid envelope.status.');
  const from = validDate(envelope.validFrom, 'envelope.validFrom');
  const until = validDate(envelope.validUntil, 'envelope.validUntil');
  if (until <= from) throw new Error('envelope.validUntil must be after validFrom.');

  const limits = envelope.limits;
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw new Error('envelope.limits must be an object.');
  positiveInteger(limits.maxAttempts, 'envelope.limits.maxAttempts');
  if (limits.maxSpendUsdPerDay !== undefined) finiteNonNegative(limits.maxSpendUsdPerDay, 'envelope.limits.maxSpendUsdPerDay', { nullable: true });
  if (limits.maxSpendUsdTotal !== undefined) finiteNonNegative(limits.maxSpendUsdTotal, 'envelope.limits.maxSpendUsdTotal', { nullable: true });
  if (limits.maxChangePercent !== undefined) finiteNonNegative(limits.maxChangePercent, 'envelope.limits.maxChangePercent', { nullable: true });
  if (limits.maxRecipients !== undefined && limits.maxRecipients !== null && (!Number.isInteger(limits.maxRecipients) || limits.maxRecipients < 0)) {
    throw new Error('envelope.limits.maxRecipients must be a non-negative integer or null.');
  }
  if (envelope.approvedActionHash !== undefined && envelope.approvedActionHash !== null && !/^[a-f0-9]{64}$/.test(envelope.approvedActionHash)) {
    throw new Error('envelope.approvedActionHash must be a SHA-256 hex string or null.');
  }
  return envelope;
}

export function validateActionRequest(action) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) throw new Error('action must be an object.');
  if (action.schemaVersion !== 1) throw new Error('Unsupported action schemaVersion.');
  requiredString(action.actionId, 'action.actionId');
  requiredString(action.tenantId, 'action.tenantId');
  requiredString(action.actionFamily, 'action.actionFamily');
  requiredString(action.actionType, 'action.actionType');
  requiredString(action.requestedBy, 'action.requestedBy');
  validDate(action.requestedAt, 'action.requestedAt');
  positiveInteger(action.attemptNumber, 'action.attemptNumber');
  if (!action.inputs || typeof action.inputs !== 'object' || Array.isArray(action.inputs)) throw new Error('action.inputs must be an object.');
  if (!action.expectedCost || typeof action.expectedCost !== 'object') throw new Error('action.expectedCost must be an object.');
  finiteNonNegative(action.expectedCost.spendUsd, 'action.expectedCost.spendUsd', { nullable: true });
  const recipients = action.expectedCost.recipients;
  if (recipients !== null && (!Number.isInteger(recipients) || recipients < 0)) throw new Error('action.expectedCost.recipients must be a non-negative integer or null.');
  if (action.currentTotalSpendUsd !== undefined) finiteNonNegative(action.currentTotalSpendUsd, 'action.currentTotalSpendUsd', { nullable: true });
  if (action.currentDailySpendUsd !== undefined) finiteNonNegative(action.currentDailySpendUsd, 'action.currentDailySpendUsd', { nullable: true });
  if (action.changePercent !== undefined) finiteNonNegative(action.changePercent, 'action.changePercent', { nullable: true });
  return action;
}

export function validateBusinessState(businessState) {
  if (!businessState) return null;
  if (typeof businessState !== 'object' || Array.isArray(businessState)) throw new Error('businessState must be an object.');
  requiredString(businessState.tenantId, 'businessState.tenantId');
  if (!['COMPLETE_FOR_PURPOSE', 'PARTIAL', 'STALE', 'UNAVAILABLE'].includes(businessState.completeness)) {
    throw new Error('Invalid businessState.completeness.');
  }
  if (!businessState.capacity || typeof businessState.capacity !== 'object') throw new Error('businessState.capacity is required.');
  if (!['AVAILABLE', 'CONSTRAINED', 'FULL', 'UNKNOWN'].includes(businessState.capacity.status)) throw new Error('Invalid businessState.capacity.status.');
  return businessState;
}
