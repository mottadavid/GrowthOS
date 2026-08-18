import { actionApprovalHash } from './canonical.mjs';
import { validateActionEnvelope, validateActionRequest, validateBusinessState } from './validators.mjs';

export const CONTROL_DECISIONS = Object.freeze({
  ALLOW: 'ALLOW',
  REQUIRE_APPROVAL: 'REQUIRE_APPROVAL',
  DENY: 'DENY',
  NO_ACTION: 'NO_ACTION'
});

function decision(decisionValue, reasons, metadata = {}) {
  return {
    decision: decisionValue,
    reasons: [...new Set(reasons)],
    metadata
  };
}

function listAllows(list, value) {
  if (!Array.isArray(list) || list.length === 0) return true;
  if (value === null || value === undefined || value === '') return false;
  return list.includes(value);
}

function addCost(current, expected) {
  const base = current ?? 0;
  return base + expected;
}

export function evaluateActionPolicy({ action, envelope, businessState = null, now = new Date() }) {
  validateActionRequest(action);
  validateActionEnvelope(envelope);
  validateBusinessState(businessState);

  const hardDenials = [];
  const approvalReasons = [];
  const noActionReasons = [];

  if (action.tenantId !== envelope.tenantId) hardDenials.push('TENANT_MISMATCH');
  if (action.actionFamily !== envelope.actionFamily) hardDenials.push('ACTION_FAMILY_NOT_AUTHORIZED');
  if (envelope.delegateSubjectId && action.requestedBy !== envelope.delegateSubjectId) hardDenials.push('DELEGATE_SUBJECT_MISMATCH');
  if (businessState && businessState.tenantId !== action.tenantId) hardDenials.push('BUSINESS_STATE_TENANT_MISMATCH');

  if (envelope.status !== 'ACTIVE') hardDenials.push(`ENVELOPE_${envelope.status}`);

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('now must be a valid date/time.');
  if (nowMs < Date.parse(envelope.validFrom)) hardDenials.push('ENVELOPE_NOT_YET_VALID');
  if (nowMs > Date.parse(envelope.validUntil)) hardDenials.push('ENVELOPE_EXPIRED');

  if (!listAllows(envelope.channels, action.channel)) hardDenials.push('CHANNEL_NOT_AUTHORIZED');
  if (!listAllows(envelope.accountIds, action.accountId)) hardDenials.push('ACCOUNT_NOT_AUTHORIZED');
  if (!listAllows(envelope.geographies, action.geography)) hardDenials.push('GEOGRAPHY_NOT_AUTHORIZED');

  if (action.attemptNumber > envelope.limits.maxAttempts) hardDenials.push('ATTEMPT_LIMIT_EXCEEDED');

  const maxRecipients = envelope.limits.maxRecipients;
  const recipients = action.expectedCost.recipients;
  if (maxRecipients !== null && maxRecipients !== undefined) {
    if (recipients === null) hardDenials.push('RECIPIENT_COUNT_UNKNOWN');
    else if (recipients > maxRecipients) hardDenials.push('RECIPIENT_LIMIT_EXCEEDED');
  }

  const expectedSpend = action.expectedCost.spendUsd;
  const maxDaily = envelope.limits.maxSpendUsdPerDay;
  const maxTotal = envelope.limits.maxSpendUsdTotal;

  if (maxDaily !== null && maxDaily !== undefined) {
    if (expectedSpend === null) hardDenials.push('SPEND_UNKNOWN');
    else if (addCost(action.currentDailySpendUsd, expectedSpend) > maxDaily) hardDenials.push('DAILY_SPEND_LIMIT_EXCEEDED');
  }

  if (maxTotal !== null && maxTotal !== undefined) {
    if (expectedSpend === null) hardDenials.push('SPEND_UNKNOWN');
    else if (addCost(action.currentTotalSpendUsd, expectedSpend) > maxTotal) hardDenials.push('TOTAL_SPEND_LIMIT_EXCEEDED');
  }

  const maxChange = envelope.limits.maxChangePercent;
  if (maxChange !== null && maxChange !== undefined && action.changePercent !== null && action.changePercent !== undefined && action.changePercent > maxChange) {
    hardDenials.push('CHANGE_LIMIT_EXCEEDED');
  }

  if (hardDenials.length) {
    return decision(CONTROL_DECISIONS.DENY, hardDenials, { envelopeId: envelope.envelopeId });
  }

  const demandIncreasing = action.inputs?.demandIncreasing === true;
  if (businessState && demandIncreasing) {
    if (['STALE', 'UNAVAILABLE'].includes(businessState.completeness)) {
      noActionReasons.push('BUSINESS_STATE_NOT_FRESH_ENOUGH_FOR_DEMAND_INCREASE');
    }
    if (['CONSTRAINED', 'FULL'].includes(businessState.capacity.status) || businessState.capacity.demandThrottleRecommended === true) {
      noActionReasons.push('BUSINESS_CAPACITY_CONSTRAINED');
    }
  }

  if (noActionReasons.length) {
    return decision(CONTROL_DECISIONS.NO_ACTION, noActionReasons, { envelopeId: envelope.envelopeId });
  }

  if (action.inputs?.increasesTotalBudget === true) approvalReasons.push('TOTAL_BUDGET_EXPANSION_REQUIRES_APPROVAL');
  if (action.inputs?.changesPublicPrice === true) approvalReasons.push('PUBLIC_PRICE_CHANGE_REQUIRES_APPROVAL');
  if (action.inputs?.createsGuarantee === true) approvalReasons.push('GUARANTEE_REQUIRES_APPROVAL');
  if (action.inputs?.materialDiscount === true) approvalReasons.push('MATERIAL_DISCOUNT_REQUIRES_APPROVAL');

  if (['L0_OBSERVE', 'L1_RECOMMEND', 'L2_DRAFT'].includes(envelope.autonomyLevel)) {
    return decision(CONTROL_DECISIONS.DENY, ['AUTONOMY_LEVEL_NOT_EXECUTABLE'], { envelopeId: envelope.envelopeId });
  }

  const approvalRequired = envelope.autonomyLevel === 'L3_APPROVAL_REQUIRED' || envelope.requiresApproval === true || approvalReasons.length > 0;
  if (approvalRequired) {
    const exactHash = actionApprovalHash(action);
    const approvalMatches = Boolean(
      action.approvalId &&
      envelope.approvalId &&
      action.approvalId === envelope.approvalId &&
      envelope.approvedActionHash &&
      envelope.approvedActionHash === exactHash
    );

    if (!approvalMatches) {
      const reasons = approvalReasons.length ? approvalReasons : ['EXPLICIT_APPROVAL_REQUIRED'];
      if (action.approvalId && envelope.approvalId && action.approvalId === envelope.approvalId && envelope.approvedActionHash && envelope.approvedActionHash !== exactHash) {
        reasons.push('APPROVED_ACTION_CHANGED');
      }
      return decision(CONTROL_DECISIONS.REQUIRE_APPROVAL, reasons, {
        envelopeId: envelope.envelopeId,
        currentActionHash: exactHash,
        approvedActionHash: envelope.approvedActionHash ?? null
      });
    }
  }

  return decision(CONTROL_DECISIONS.ALLOW, ['ACTION_WITHIN_ACTIVE_ENVELOPE'], {
    envelopeId: envelope.envelopeId,
    autonomyLevel: envelope.autonomyLevel,
    actionHash: actionApprovalHash(action)
  });
}
