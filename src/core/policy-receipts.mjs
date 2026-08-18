import { actionApprovalHash, sha256Canonical } from './canonical.mjs';
import { CONTROL_DECISIONS } from './control-plane.mjs';
import { validateActionEnvelope, validateActionRequest } from './validators.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function iso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} must be a valid date/time.`);
  return date.toISOString();
}

export function approvalBoundEnvelope(envelope) {
  validateActionEnvelope(envelope);
  return {
    schemaVersion: envelope.schemaVersion,
    envelopeId: envelope.envelopeId,
    tenantId: envelope.tenantId,
    actionFamily: envelope.actionFamily,
    autonomyLevel: envelope.autonomyLevel,
    status: envelope.status,
    validFrom: envelope.validFrom,
    validUntil: envelope.validUntil,
    channels: envelope.channels ?? [],
    accountIds: envelope.accountIds ?? [],
    geographies: envelope.geographies ?? [],
    limits: envelope.limits,
    requiresApproval: envelope.requiresApproval === true,
    approvalId: envelope.approvalId ?? null,
    approvedActionHash: envelope.approvedActionHash ?? null,
    policyVersion: envelope.policyVersion ?? null
  };
}

export function envelopeAuthorityHash(envelope) {
  return sha256Canonical(approvalBoundEnvelope(envelope));
}

function receiptBody(receipt) {
  const { receiptHash, ...body } = receipt;
  return body;
}

export function policyReceiptHash(receipt) {
  return sha256Canonical(receiptBody(receipt));
}

export function validatePolicyDecisionReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('receipt must be an object.');
  if (receipt.schemaVersion !== 1) throw new Error('Unsupported receipt schemaVersion.');
  requiredString(receipt.receiptId, 'receipt.receiptId');
  requiredString(receipt.tenantId, 'receipt.tenantId');
  requiredString(receipt.actionId, 'receipt.actionId');
  requiredString(receipt.envelopeId, 'receipt.envelopeId');
  if (!/^[0-9a-f]{64}$/.test(receipt.actionHash || '')) throw new Error('receipt.actionHash must be SHA-256 hex.');
  if (!/^[0-9a-f]{64}$/.test(receipt.envelopeHash || '')) throw new Error('receipt.envelopeHash must be SHA-256 hex.');
  if (!Object.values(CONTROL_DECISIONS).includes(receipt.decision)) throw new Error('Invalid receipt.decision.');
  if (!Array.isArray(receipt.reasons) || receipt.reasons.length === 0 || receipt.reasons.some(reason => typeof reason !== 'string' || !reason.trim())) {
    throw new Error('receipt.reasons must contain at least one non-empty reason.');
  }
  iso(receipt.evaluatedAt, 'receipt.evaluatedAt');
  if (!receipt.summary || typeof receipt.summary !== 'object' || Array.isArray(receipt.summary)) throw new Error('receipt.summary must be an object.');
  requiredString(receipt.summary.actionFamily, 'receipt.summary.actionFamily');
  requiredString(receipt.summary.actionType, 'receipt.summary.actionType');
  if (!/^[0-9a-f]{64}$/.test(receipt.receiptHash || '')) throw new Error('receipt.receiptHash must be SHA-256 hex.');
  const expected = policyReceiptHash(receipt);
  if (expected !== receipt.receiptHash) throw new Error('POLICY_RECEIPT_HASH_MISMATCH');
  return receipt;
}

export function createPolicyDecisionReceipt({
  action,
  envelope,
  decision,
  evaluatedAt = new Date(),
  receiptId = null
}) {
  validateActionRequest(action);
  validateActionEnvelope(envelope);
  if (!decision || typeof decision !== 'object') throw new Error('decision is required.');
  if (!Object.values(CONTROL_DECISIONS).includes(decision.decision)) throw new Error('Invalid decision.decision.');
  if (!Array.isArray(decision.reasons) || decision.reasons.length === 0) throw new Error('decision.reasons must not be empty.');
  if (action.tenantId !== envelope.tenantId) throw new Error('ACTION_ENVELOPE_TENANT_MISMATCH');

  const evaluatedAtIso = iso(evaluatedAt, 'evaluatedAt');
  const receipt = {
    schemaVersion: 1,
    receiptId: receiptId || `policy-${action.actionId}-${sha256Canonical([action.actionId, envelope.envelopeId, evaluatedAtIso]).slice(0, 12)}`,
    tenantId: action.tenantId,
    actionId: action.actionId,
    actionHash: actionApprovalHash(action),
    envelopeId: envelope.envelopeId,
    envelopeHash: envelopeAuthorityHash(envelope),
    decision: decision.decision,
    reasons: [...new Set(decision.reasons)],
    evaluatedAt: evaluatedAtIso,
    autonomyLevel: envelope.autonomyLevel,
    summary: {
      actionFamily: action.actionFamily,
      actionType: action.actionType,
      channel: action.channel ?? null,
      accountId: action.accountId ?? null,
      geography: action.geography ?? null,
      expectedSpendUsd: action.expectedCost?.spendUsd ?? null,
      expectedRecipients: action.expectedCost?.recipients ?? null
    }
  };

  return {
    ...receipt,
    receiptHash: sha256Canonical(receipt)
  };
}

export function assertPolicyReceiptMatches({ receipt, action, envelope }) {
  validatePolicyDecisionReceipt(receipt);
  validateActionRequest(action);
  validateActionEnvelope(envelope);
  if (receipt.tenantId !== action.tenantId || receipt.tenantId !== envelope.tenantId) throw new Error('POLICY_RECEIPT_TENANT_MISMATCH');
  if (receipt.actionId !== action.actionId) throw new Error('POLICY_RECEIPT_ACTION_ID_MISMATCH');
  if (receipt.envelopeId !== envelope.envelopeId) throw new Error('POLICY_RECEIPT_ENVELOPE_ID_MISMATCH');
  if (receipt.actionHash !== actionApprovalHash(action)) throw new Error('POLICY_RECEIPT_ACTION_CHANGED');
  if (receipt.envelopeHash !== envelopeAuthorityHash(envelope)) throw new Error('POLICY_RECEIPT_ENVELOPE_CHANGED');
  return true;
}

export function policyReceiptToGrowthEvent(receipt, { eventId = null, recordedAt = null } = {}) {
  validatePolicyDecisionReceipt(receipt);
  const recorded = recordedAt === null ? receipt.evaluatedAt : iso(recordedAt, 'recordedAt');
  return {
    schemaVersion: 1,
    eventId: eventId || `event-${receipt.receiptId}`,
    eventType: 'growth.policy.decision',
    tenantId: receipt.tenantId,
    occurredAt: receipt.evaluatedAt,
    recordedAt: recorded,
    correlationId: receipt.actionId,
    causationId: null,
    sourceSystem: 'growthos',
    actor: 'control-plane',
    executionCertainty: 'NOT_APPLICABLE',
    attributionConfidence: 'NOT_APPLICABLE',
    payload: {
      receiptId: receipt.receiptId,
      receiptHash: receipt.receiptHash,
      actionId: receipt.actionId,
      actionHash: receipt.actionHash,
      envelopeId: receipt.envelopeId,
      envelopeHash: receipt.envelopeHash,
      decision: receipt.decision,
      reasons: receipt.reasons,
      autonomyLevel: receipt.autonomyLevel,
      summary: receipt.summary
    }
  };
}
