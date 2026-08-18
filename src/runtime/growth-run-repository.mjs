import { sha256Canonical } from '../core/canonical.mjs';
import { createGrowthRunManifest, validateGrowthRunManifest } from '../core/growth-run.mjs';
import { loadDurableWiserrGrowthSnapshot } from './wiserr-snapshot-repository.mjs';
import { loadDurableReactivationOpportunityEvaluation } from './reactivation-opportunity-repository.mjs';
import { loadDurableReactivationCampaign } from './reactivation-campaign-repository.mjs';
import { loadDurableExperiment } from './experiment-repository.mjs';
import { loadDurableActionEnvelope } from './action-envelope-repository.mjs';
import { loadDurablePolicyAuthorization } from './policy-authorization-repository.mjs';
import { loadDurableExecutionAttempt } from './execution-attempt-repository.mjs';
import { listDurableBusinessOutcomes } from './business-outcome-repository.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const GROWTH_RUN_MANIFEST_RECORD_TYPE = 'growth_run_manifest';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function uniqueByRecordId(records) {
  const map = new Map();
  for (const record of records) map.set(record.recordId, record);
  return [...map.values()];
}

async function requireRecord(load, errorCode) {
  const record = await load();
  if (!record) throw new Error(errorCode);
  return record;
}

function validateRecord(record, tenantId) {
  const manifest = record?.payload?.manifest;
  if (!manifest) throw new Error('DURABLE_GROWTH_RUN_MANIFEST_MISSING');
  validateGrowthRunManifest(manifest);
  if (record.tenantId !== tenantId || manifest.tenantId !== tenantId || record.recordId !== manifest.runId || record.indexKey !== manifest.actionId) {
    throw new Error('DURABLE_GROWTH_RUN_MANIFEST_IDENTITY_MISMATCH');
  }
  if (record.payload.manifestHash !== manifest.manifestHash) throw new Error('DURABLE_GROWTH_RUN_MANIFEST_HASH_MISMATCH');
  return record;
}

export async function loadDurableGrowthRunManifest({ store, tenantId, runId }) {
  requiredString(tenantId, 'tenantId');
  requiredString(runId, 'runId');
  const record = await store.getRecord({ tenantId, recordType: GROWTH_RUN_MANIFEST_RECORD_TYPE, recordId: runId });
  return record ? validateRecord(record, tenantId) : null;
}

export async function listDurableGrowthRunManifests({ store, tenantId, actionId, limit = 1000 }) {
  requiredString(tenantId, 'tenantId');
  requiredString(actionId, 'actionId');
  const records = await store.listRecords({ tenantId, recordType: GROWTH_RUN_MANIFEST_RECORD_TYPE, indexKey: actionId, limit });
  return records.map(record => validateRecord(record, tenantId));
}

export async function buildAndPersistDurableGrowthRunManifest({
  store,
  tenantId,
  snapshotId,
  opportunityEvaluationId,
  campaignId,
  experimentId,
  envelopeId,
  policyReceiptId,
  attemptId,
  runId = null,
  now = new Date()
}) {
  for (const [label, value] of Object.entries({ tenantId, snapshotId, opportunityEvaluationId, campaignId, experimentId, envelopeId, policyReceiptId, attemptId })) {
    requiredString(value, label);
  }

  const snapshotRecord = await requireRecord(
    () => loadDurableWiserrGrowthSnapshot({ store, tenantId, snapshotId }),
    'DURABLE_GROWTH_RUN_SNAPSHOT_NOT_FOUND'
  );
  const opportunityRecord = await requireRecord(
    () => loadDurableReactivationOpportunityEvaluation({ store, tenantId, evaluationId: opportunityEvaluationId }),
    'DURABLE_GROWTH_RUN_OPPORTUNITY_NOT_FOUND'
  );
  if (opportunityRecord.payload.result.decision !== 'OPPORTUNITY' || !opportunityRecord.payload.result.opportunity) {
    throw new Error('DURABLE_GROWTH_RUN_OPPORTUNITY_NOT_ACTIONABLE');
  }
  if (opportunityRecord.payload.snapshotId !== snapshotId || opportunityRecord.payload.snapshotHash !== snapshotRecord.payload.snapshotHash) {
    throw new Error('DURABLE_GROWTH_RUN_OPPORTUNITY_SOURCE_MISMATCH');
  }

  const campaignRecord = await requireRecord(
    () => loadDurableReactivationCampaign({ store, tenantId, campaignId }),
    'DURABLE_GROWTH_RUN_CAMPAIGN_NOT_FOUND'
  );
  const experimentRecord = await requireRecord(
    () => loadDurableExperiment({ store, tenantId, experimentId }),
    'DURABLE_GROWTH_RUN_EXPERIMENT_NOT_FOUND'
  );
  const envelopeRecord = await requireRecord(
    () => loadDurableActionEnvelope({ store, tenantId, envelopeId }),
    'DURABLE_GROWTH_RUN_ENVELOPE_NOT_FOUND'
  );
  const policyRecord = await requireRecord(
    () => loadDurablePolicyAuthorization({ store, tenantId, receiptId: policyReceiptId }),
    'DURABLE_GROWTH_RUN_POLICY_NOT_FOUND'
  );
  const attemptRecord = await requireRecord(
    () => loadDurableExecutionAttempt({ store, tenantId, attemptId }),
    'DURABLE_GROWTH_RUN_ATTEMPT_NOT_FOUND'
  );

  const action = policyRecord.payload.action;
  const opportunity = opportunityRecord.payload.result.opportunity;
  const campaign = campaignRecord.payload;
  const experiment = experimentRecord.payload;
  const envelope = envelopeRecord.payload;
  const attempt = attemptRecord.payload;
  const policyReceipt = policyRecord.payload.receipt;
  const resolvedRunId = runId || `growth-run-${action.actionId}`;

  const correlations = [...new Set([resolvedRunId, campaign.campaignId, experiment.experimentId, action.actionId])];
  const outcomeRecords = uniqueByRecordId((await Promise.all(
    correlations.map(correlationId => listDurableBusinessOutcomes({ store, tenantId, correlationId }))
  )).flat());
  const outcomeEvents = outcomeRecords.map(record => structuredClone(record.payload.event));

  const manifest = createGrowthRunManifest({
    runId: resolvedRunId,
    snapshot: structuredClone(snapshotRecord.payload.snapshot),
    opportunity: structuredClone(opportunity),
    campaign: structuredClone(campaign),
    experiment: structuredClone(experiment),
    envelope: structuredClone(envelope),
    action: structuredClone(action),
    attempt: structuredClone(attempt),
    policyReceipt: structuredClone(policyReceipt),
    outcomeEvents
  });
  validateGrowthRunManifest(manifest);

  const sourceProof = {
    snapshotRecordHash: snapshotRecord.payload.snapshotHash,
    opportunityRecordHash: sha256Canonical(opportunityRecord.payload),
    campaignRecordHash: sha256Canonical(campaignRecord.payload),
    experimentRecordHash: sha256Canonical(experimentRecord.payload),
    envelopeRecordHash: sha256Canonical(envelopeRecord.payload),
    policyRecordHash: sha256Canonical(policyRecord.payload),
    attemptRecordHash: sha256Canonical(attemptRecord.payload),
    outcomeRecordHashes: outcomeRecords.map(record => ({ recordId: record.recordId, semanticHash: record.payload.semanticHash })).sort((a, b) => a.recordId.localeCompare(b.recordId))
  };
  const sourceProofHash = sha256Canonical(sourceProof);
  const payload = { schemaVersion: 1, manifest: structuredClone(manifest), manifestHash: manifest.manifestHash, sourceProof, sourceProofHash };

  const existing = await loadDurableGrowthRunManifest({ store, tenantId, runId: resolvedRunId });
  if (existing) {
    if (sha256Canonical(existing.payload) !== sha256Canonical(payload)) throw new Error('DURABLE_GROWTH_RUN_MANIFEST_CONFLICT');
    return { record: existing, manifest: structuredClone(existing.payload.manifest), idempotent: true };
  }

  const saved = await mutateAuthoritativeRuntimeState({
    store,
    tenantId,
    recordType: GROWTH_RUN_MANIFEST_RECORD_TYPE,
    recordId: resolvedRunId,
    indexKey: action.actionId,
    payload,
    expectedRevision: 0,
    now,
    event: {
      eventId: `growth-run-manifest:${resolvedRunId}`,
      eventType: 'growth.run_manifest.persisted',
      payload: {
        runId: resolvedRunId,
        manifestHash: manifest.manifestHash,
        sourceProofHash,
        actionId: action.actionId,
        attemptId: attempt.attemptId,
        outcomeCount: outcomeRecords.length
      },
      correlationId: resolvedRunId
    }
  });

  return { record: validateRecord(saved.record, tenantId), manifest, idempotent: false };
}
