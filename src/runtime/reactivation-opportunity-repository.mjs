import { sha256Canonical } from '../core/canonical.mjs';
import { evaluateDormantLeadReactivation } from '../opportunities/reactivation.mjs';
import { toGrowthBusinessState } from '../integrations/wiserr/growth-snapshot.mjs';
import { validateGrowthSnapshotFreshness } from '../integrations/wiserr/read-client.mjs';
import { loadDurableWiserrGrowthSnapshot } from './wiserr-snapshot-repository.mjs';
import { loadDurableCapacityBundle, assertCapacityBundleUsableForDemand } from './capacity-bundle-repository.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const REACTIVATION_OPPORTUNITY_RECORD_TYPE = 'reactivation_opportunity_evaluation';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function detectorPolicy(options = {}) {
  return {
    minDormantLeads: options.minDormantLeads ?? 25,
    expectedResponseRateLow: options.expectedResponseRateLow ?? 0.02,
    expectedResponseRateHigh: options.expectedResponseRateHigh ?? 0.08
  };
}

export function durableReactivationOpportunityEvaluationId({ snapshotHash, capacitySemanticHash, detectorPolicyHash }) {
  return `reactivation-eval-${sha256Canonical({ snapshotHash, capacitySemanticHash, detectorPolicyHash })}`;
}

function validateRecord(record, tenantId) {
  const payload = record?.payload;
  if (!payload || payload.schemaVersion !== 1) throw new Error('Invalid durable opportunity payload.');
  for (const key of ['snapshotHash', 'capacitySemanticHash', 'detectorPolicyHash']) {
    if (!/^[0-9a-f]{64}$/.test(payload[key] || '')) throw new Error(`${key} must be SHA-256 hex.`);
  }
  const expectedId = durableReactivationOpportunityEvaluationId(payload);
  if (record.tenantId !== tenantId || record.recordId !== expectedId || record.indexKey !== payload.snapshotId) {
    throw new Error('DURABLE_REACTIVATION_OPPORTUNITY_IDENTITY_MISMATCH');
  }
  if (!['OPPORTUNITY', 'NO_ACTION', 'INSUFFICIENT_EVIDENCE'].includes(payload.result?.decision)) throw new Error('Invalid opportunity decision.');
  if (payload.result.opportunity?.businessSnapshotId !== undefined && payload.result.opportunity.businessSnapshotId !== payload.snapshotId) {
    throw new Error('DURABLE_REACTIVATION_OPPORTUNITY_SNAPSHOT_MISMATCH');
  }
  return record;
}

export async function loadDurableReactivationOpportunityEvaluation({ store, tenantId, evaluationId }) {
  requiredString(tenantId, 'tenantId');
  requiredString(evaluationId, 'evaluationId');
  const record = await store.getRecord({ tenantId, recordType: REACTIVATION_OPPORTUNITY_RECORD_TYPE, recordId: evaluationId });
  return record ? validateRecord(record, tenantId) : null;
}

export async function listDurableReactivationOpportunityEvaluations({ store, tenantId, snapshotId, limit = 1000 }) {
  requiredString(tenantId, 'tenantId');
  requiredString(snapshotId, 'snapshotId');
  const records = await store.listRecords({ tenantId, recordType: REACTIVATION_OPPORTUNITY_RECORD_TYPE, indexKey: snapshotId, limit });
  return records.map(record => validateRecord(record, tenantId));
}

export async function evaluateAndPersistDurableReactivationOpportunity({
  store, tenantId, snapshotId, capacityEvidenceId, capacityAuthorityId,
  options = {}, now = new Date(), maxSnapshotAgeMinutes = 15
}) {
  requiredString(tenantId, 'tenantId');
  const snapshotRecord = await loadDurableWiserrGrowthSnapshot({ store, tenantId, snapshotId });
  if (!snapshotRecord) throw new Error('DURABLE_WISERR_SNAPSHOT_NOT_FOUND');
  validateGrowthSnapshotFreshness(snapshotRecord.payload.snapshot, { now, maxAgeMinutes: maxSnapshotAgeMinutes });

  const capacityRecord = await loadDurableCapacityBundle({ store, tenantId, evidenceId: capacityEvidenceId, authorityId: capacityAuthorityId });
  if (!capacityRecord) throw new Error('DURABLE_CAPACITY_BUNDLE_NOT_FOUND');
  const capacityProof = assertCapacityBundleUsableForDemand(capacityRecord, { now });

  const policy = detectorPolicy(options);
  const detectorPolicyHash = sha256Canonical(policy);
  const evaluationId = durableReactivationOpportunityEvaluationId({
    snapshotHash: snapshotRecord.payload.snapshotHash,
    capacitySemanticHash: capacityRecord.payload.semanticHash,
    detectorPolicyHash
  });
  const existing = await loadDurableReactivationOpportunityEvaluation({ store, tenantId, evaluationId });
  if (existing) return { record: existing, result: structuredClone(existing.payload.result), idempotent: true };

  const businessState = toGrowthBusinessState(snapshotRecord.payload.snapshot);
  businessState.capacity = {
    status: capacityProof.derived.status,
    demandThrottleRecommended: capacityProof.derived.demandThrottleRecommended
  };
  const result = evaluateDormantLeadReactivation(businessState, { ...policy, now });
  const payload = {
    schemaVersion: 1,
    snapshotId,
    snapshotHash: snapshotRecord.payload.snapshotHash,
    snapshotAuthorityLockFingerprint: snapshotRecord.payload.authority.lockFingerprint,
    capacityBundleId: capacityRecord.recordId,
    capacitySemanticHash: capacityRecord.payload.semanticHash,
    capacityAuthorityHash: capacityProof.derived.authorityHash,
    detectorPolicy: policy,
    detectorPolicyHash,
    result: structuredClone(result)
  };

  const saved = await mutateAuthoritativeRuntimeState({
    store,
    tenantId,
    recordType: REACTIVATION_OPPORTUNITY_RECORD_TYPE,
    recordId: evaluationId,
    indexKey: snapshotId,
    payload,
    expectedRevision: 0,
    now,
    event: {
      eventId: `reactivation-opportunity:${evaluationId}`,
      eventType: 'growth.opportunity.evaluated',
      payload: {
        evaluationId,
        snapshotId,
        snapshotHash: payload.snapshotHash,
        capacityBundleId: payload.capacityBundleId,
        capacitySemanticHash: payload.capacitySemanticHash,
        detectorPolicyHash,
        decision: result.decision,
        opportunityId: result.opportunity?.opportunityId ?? null,
        reasons: [...result.reasons]
      },
      correlationId: result.opportunity?.opportunityId ?? evaluationId
    }
  });
  return { record: validateRecord(saved.record, tenantId), result, idempotent: false };
}
