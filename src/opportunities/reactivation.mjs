import { validateBusinessState } from '../core/validators.mjs';

export const REACTIVATION_DECISIONS = Object.freeze({
  OPPORTUNITY: 'OPPORTUNITY',
  NO_ACTION: 'NO_ACTION',
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE'
});

function roundRange(value) {
  return Math.max(0, Math.round(value));
}

export function evaluateDormantLeadReactivation(businessState, {
  minDormantLeads = 25,
  expectedResponseRateLow = 0.02,
  expectedResponseRateHigh = 0.08,
  now = new Date()
} = {}) {
  validateBusinessState(businessState);

  if (!Number.isInteger(minDormantLeads) || minDormantLeads < 1) throw new Error('minDormantLeads must be a positive integer.');
  if (!Number.isFinite(expectedResponseRateLow) || expectedResponseRateLow < 0 || expectedResponseRateLow > 1) throw new Error('expectedResponseRateLow must be between 0 and 1.');
  if (!Number.isFinite(expectedResponseRateHigh) || expectedResponseRateHigh < expectedResponseRateLow || expectedResponseRateHigh > 1) {
    throw new Error('expectedResponseRateHigh must be between expectedResponseRateLow and 1.');
  }

  if (['STALE', 'UNAVAILABLE'].includes(businessState.completeness)) {
    return {
      decision: REACTIVATION_DECISIONS.INSUFFICIENT_EVIDENCE,
      reasons: ['BUSINESS_STATE_NOT_FRESH_ENOUGH']
    };
  }

  const dormantLeads = businessState.cohorts?.dormantLeads;
  if (!Number.isInteger(dormantLeads) || dormantLeads < 0) {
    return {
      decision: REACTIVATION_DECISIONS.INSUFFICIENT_EVIDENCE,
      reasons: ['DORMANT_LEAD_COUNT_UNAVAILABLE']
    };
  }

  if (businessState.capacity?.status === 'FULL' || businessState.capacity?.demandThrottleRecommended === true) {
    return {
      decision: REACTIVATION_DECISIONS.NO_ACTION,
      reasons: ['BUSINESS_CAPACITY_DOES_NOT_JUSTIFY_MORE_DEMAND']
    };
  }

  if (dormantLeads < minDormantLeads) {
    return {
      decision: REACTIVATION_DECISIONS.NO_ACTION,
      reasons: ['COHORT_BELOW_MINIMUM_ACTION_THRESHOLD'],
      metadata: { dormantLeads, minDormantLeads }
    };
  }

  const constrained = businessState.capacity?.status === 'CONSTRAINED';
  const detectedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();

  return {
    decision: REACTIVATION_DECISIONS.OPPORTUNITY,
    reasons: ['DORMANT_LEAD_COHORT_AVAILABLE'],
    opportunity: {
      schemaVersion: 1,
      opportunityId: `reactivation-${businessState.tenantId}-${businessState.snapshotId || 'snapshot'}`,
      tenantId: businessState.tenantId,
      type: 'DORMANT_LEAD_REACTIVATION',
      status: 'DETECTED',
      detectedAt,
      businessSnapshotId: businessState.snapshotId || 'unknown',
      evidence: [
        {
          kind: 'BUSINESS_STATE_COHORT',
          reference: businessState.snapshotId || 'unknown',
          summary: `${dormantLeads} dormant leads are present in the current growth read model.`
        }
      ],
      expectedImpact: {
        metric: 'engaged_responses',
        low: roundRange(dormantLeads * expectedResponseRateLow),
        high: roundRange(dormantLeads * expectedResponseRateHigh),
        units: 'responses'
      },
      uncertainty: 'HIGH',
      urgency: 'MEDIUM',
      operationalFeasibility: constrained ? 'CONSTRAINED' : 'FEASIBLE',
      requiredAutonomyLevel: 'L3_APPROVAL_REQUIRED',
      notes: 'Impact range is a planning hypothesis until tenant-specific historical evidence exists.'
    }
  };
}
