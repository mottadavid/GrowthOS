import { sha256Canonical } from '../core/canonical.mjs';
import { EXECUTION_ATTEMPT_STATES } from '../core/execution-attempts.mjs';
import { createGrowthRunManifest, validateGrowthRunManifest } from '../core/growth-run.mjs';
import { loadDurableWiserrGrowthSnapshot } from './wiserr-snapshot-repository.mjs';
import { loadDurableReactivationOpportunityEvaluation } from './reactivation-opportunity-repository.mjs';
import { loadDurableReactivationCampaign } from './reactivation-campaign-repository.mjs';
import { loadDurableExperiment } from './experiment-repository.mjs';
import { loadDurablePolicyAuthorization } from './policy-authorization-repository.mjs';
import { loadDurableExecutionAttempt } from './execution-attempt-repository.mjs';
import { listDurableWiserrReactivationCommands } from './wiserr-reactivation-command-repository.mjs';
import { listDurableWiserrSubmissionResults } from './wiserr-submission-result-ingestion.mjs';
import { listDurableBusinessOutcomes } from './business-outcome-repository.mjs';
import { listDurableExecutionEconomicsEvents, summarizeExecutionEconomics } from './execution-economics-repository.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const GROWTH_RUN_MANIFEST_RECORD_TYPE = 'growth_run_manifest';
const COMMAND_REQUIRED_STATES = new Set(['SUBMITTING','ACCEPTED','COMPLETED','DEFINITIVE_FAILURE','SUPPRESSED','RECONCILIATION_REQUIRED','RECONCILED_COMPLETED','RECONCILED_FAILED','NOT_ACCEPTED']);
const REQUIRED_CANONICAL_RESULT_BY_STATE = Object.freeze({ [EXECUTION_ATTEMPT_STATES.ACCEPTED]: 'ACCEPTED', [EXECUTION_ATTEMPT_STATES.COMPLETED]: 'COMPLETED', [EXECUTION_ATTEMPT_STATES.SUPPRESSED]: 'SUPPRESSED', [EXECUTION_ATTEMPT_STATES.NOT_ACCEPTED]: 'NOT_ACCEPTED' });
function requiredString(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`); return value; }
function uniqueByRecordId(records) { const map = new Map(); for (const record of records) map.set(record.recordId, record); return [...map.values()]; }
async function requireRecord(load, errorCode) { const record = await load(); if (!record) throw new Error(errorCode); return record; }
function validateRecord(record, tenantId) {
  const manifest = record?.payload?.manifest;
  if (!manifest) throw new Error('DURABLE_GROWTH_RUN_MANIFEST_MISSING');
  validateGrowthRunManifest(manifest);
  if (record.tenantId !== tenantId || manifest.tenantId !== tenantId || record.recordId !== manifest.runId || record.indexKey !== manifest.actionId) throw new Error('DURABLE_GROWTH_RUN_MANIFEST_IDENTITY_MISMATCH');
  if (record.payload.manifestHash !== manifest.manifestHash) throw new Error('DURABLE_GROWTH_RUN_MANIFEST_HASH_MISMATCH');
  if (!/^[0-9a-f]{64}$/.test(record.payload.sourceProofHash || '')) throw new Error('DURABLE_GROWTH_RUN_SOURCE_PROOF_HASH_INVALID');
  if (sha256Canonical(record.payload.sourceProof) !== record.payload.sourceProofHash) throw new Error('DURABLE_GROWTH_RUN_SOURCE_PROOF_MISMATCH');
  return record;
}
function assertCommandAttemptIdentity(commandRecord, action, attempt) {
  const command = commandRecord?.payload?.command;
  if (!command) throw new Error('DURABLE_GROWTH_RUN_EXECUTION_COMMAND_INVALID');
  if (command.tenantId !== attempt.tenantId || command.actionId !== action.actionId || command.actionHash !== attempt.actionHash || command.attemptId !== attempt.attemptId || command.attemptNumber !== attempt.attemptNumber || command.idempotencyKey !== attempt.idempotencyKey) throw new Error('DURABLE_GROWTH_RUN_EXECUTION_COMMAND_MISMATCH');
  return command;
}
async function collectTransportProof({ store, tenantId, action, attempt }) {
  const commandRecords = (await listDurableWiserrReactivationCommands({ store, tenantId, actionId: action.actionId })).filter(record => record.payload.command.attemptId === attempt.attemptId);
  if (COMMAND_REQUIRED_STATES.has(attempt.state) && commandRecords.length === 0) throw new Error('DURABLE_GROWTH_RUN_EXECUTION_COMMAND_NOT_FOUND');
  if (commandRecords.length > 1) throw new Error('DURABLE_GROWTH_RUN_MULTIPLE_EXECUTION_COMMANDS_FOR_ATTEMPT');
  const commandRecord = commandRecords[0] ?? null;
  if (commandRecord) assertCommandAttemptIdentity(commandRecord, action, attempt);
  const resultRecords = await listDurableWiserrSubmissionResults({ store, tenantId, attemptId: attempt.attemptId });
  for (const record of resultRecords) if (record.payload.result.commandId !== commandRecord?.payload.command.commandId) throw new Error('DURABLE_GROWTH_RUN_SUBMISSION_RESULT_COMMAND_MISMATCH');
  const requiredOutcome = REQUIRED_CANONICAL_RESULT_BY_STATE[attempt.state] ?? null;
  if (requiredOutcome && !resultRecords.some(record => record.payload.result.outcome === requiredOutcome)) throw new Error(`DURABLE_GROWTH_RUN_REQUIRED_SUBMISSION_RESULT_MISSING:${requiredOutcome}`);
  return {
    command: commandRecord ? { recordId: commandRecord.recordId, commandId: commandRecord.payload.command.commandId, commandHash: commandRecord.payload.command.commandHash, commandSemanticHash: commandRecord.payload.commandSemanticHash, attemptId: commandRecord.payload.command.attemptId } : null,
    results: resultRecords.map(record => ({ recordId: record.recordId, semanticHash: record.payload.semanticHash, outcome: record.payload.result.outcome })).sort((a, b) => a.recordId.localeCompare(b.recordId))
  };
}
export async function loadDurableGrowthRunManifest({ store, tenantId, runId }) { requiredString(tenantId, 'tenantId'); requiredString(runId, 'runId'); const record = await store.getRecord({ tenantId, recordType: GROWTH_RUN_MANIFEST_RECORD_TYPE, recordId: runId }); return record ? validateRecord(record, tenantId) : null; }
export async function listDurableGrowthRunManifests({ store, tenantId, actionId, limit = 1000 }) { requiredString(tenantId, 'tenantId'); requiredString(actionId, 'actionId'); const records = await store.listRecords({ tenantId, recordType: GROWTH_RUN_MANIFEST_RECORD_TYPE, indexKey: actionId, limit }); return records.map(record => validateRecord(record, tenantId)); }

export async function buildAndPersistDurableGrowthRunManifest({ store, tenantId, snapshotId, opportunityEvaluationId, campaignId, experimentId, envelopeId, policyReceiptId, attemptId, runId = null, now = new Date() }) {
  for (const [label, value] of Object.entries({ tenantId, snapshotId, opportunityEvaluationId, campaignId, experimentId, envelopeId, policyReceiptId, attemptId })) requiredString(value, label);
  const snapshotRecord = await requireRecord(() => loadDurableWiserrGrowthSnapshot({ store, tenantId, snapshotId }), 'DURABLE_GROWTH_RUN_SNAPSHOT_NOT_FOUND');
  const opportunityRecord = await requireRecord(() => loadDurableReactivationOpportunityEvaluation({ store, tenantId, evaluationId: opportunityEvaluationId }), 'DURABLE_GROWTH_RUN_OPPORTUNITY_NOT_FOUND');
  if (opportunityRecord.payload.result.decision !== 'OPPORTUNITY' || !opportunityRecord.payload.result.opportunity) throw new Error('DURABLE_GROWTH_RUN_OPPORTUNITY_NOT_ACTIONABLE');
  if (opportunityRecord.payload.snapshotId !== snapshotId || opportunityRecord.payload.snapshotHash !== snapshotRecord.payload.snapshotHash) throw new Error('DURABLE_GROWTH_RUN_OPPORTUNITY_SOURCE_MISMATCH');
  const campaignRecord = await requireRecord(() => loadDurableReactivationCampaign({ store, tenantId, campaignId }), 'DURABLE_GROWTH_RUN_CAMPAIGN_NOT_FOUND');
  const experimentRecord = await requireRecord(() => loadDurableExperiment({ store, tenantId, experimentId }), 'DURABLE_GROWTH_RUN_EXPERIMENT_NOT_FOUND');
  const policyRecord = await requireRecord(() => loadDurablePolicyAuthorization({ store, tenantId, receiptId: policyReceiptId }), 'DURABLE_GROWTH_RUN_POLICY_NOT_FOUND');
  const attemptRecord = await requireRecord(() => loadDurableExecutionAttempt({ store, tenantId, attemptId }), 'DURABLE_GROWTH_RUN_ATTEMPT_NOT_FOUND');
  const action = policyRecord.payload.action, opportunity = opportunityRecord.payload.result.opportunity, campaign = campaignRecord.payload, experiment = experimentRecord.payload, envelope = policyRecord.payload.envelope, attempt = attemptRecord.payload, policyReceipt = policyRecord.payload.receipt;
  if (envelope.envelopeId !== envelopeId || policyRecord.payload.envelopeId !== envelopeId) throw new Error('DURABLE_GROWTH_RUN_POLICY_ENVELOPE_MISMATCH');
  const resolvedRunId = runId || `growth-run-${action.actionId}`;
  const transportProof = await collectTransportProof({ store, tenantId, action, attempt });
  const correlations = [...new Set([resolvedRunId, campaign.campaignId, experiment.experimentId, action.actionId])];
  const outcomeRecords = uniqueByRecordId((await Promise.all(correlations.map(correlationId => listDurableBusinessOutcomes({ store, tenantId, correlationId })))).flat());
  const outcomeEvents = outcomeRecords.map(record => structuredClone(record.payload.event));
  const economicsRecords = await listDurableExecutionEconomicsEvents({ store, tenantId, correlationId: action.actionId });
  const economicsSummary = summarizeExecutionEconomics(economicsRecords);
  const manifest = createGrowthRunManifest({ runId: resolvedRunId, snapshot: structuredClone(snapshotRecord.payload.snapshot), opportunity: structuredClone(opportunity), campaign: structuredClone(campaign), experiment: structuredClone(experiment), envelope: structuredClone(envelope), action: structuredClone(action), attempt: structuredClone(attempt), policyReceipt: structuredClone(policyReceipt), outcomeEvents });
  validateGrowthRunManifest(manifest);
  const sourceProof = {
    snapshotRecordHash: snapshotRecord.payload.snapshotHash,
    opportunityRecordHash: sha256Canonical(opportunityRecord.payload),
    campaignRecordHash: sha256Canonical(campaignRecord.payload),
    experimentRecordHash: sha256Canonical(experimentRecord.payload),
    policyRecordHash: sha256Canonical(policyRecord.payload),
    evaluatedEnvelopeHash: policyRecord.payload.envelopeHash,
    attemptRecordHash: sha256Canonical(attemptRecord.payload),
    transport: transportProof,
    outcomeRecordHashes: outcomeRecords.map(record => ({ recordId: record.recordId, semanticHash: record.payload.semanticHash })).sort((a, b) => a.recordId.localeCompare(b.recordId)),
    economicsRecordHashes: economicsRecords.map(record => ({ recordId: record.recordId, semanticHash: record.payload.semanticHash })).sort((a, b) => a.recordId.localeCompare(b.recordId))
  };
  const sourceProofHash = sha256Canonical(sourceProof);
  const payload = { schemaVersion: 1, manifest: structuredClone(manifest), manifestHash: manifest.manifestHash, sourceProof, sourceProofHash, economicsSummary };
  const existing = await loadDurableGrowthRunManifest({ store, tenantId, runId: resolvedRunId });
  if (existing) {
    if (sha256Canonical(existing.payload) !== sha256Canonical(payload)) throw new Error('DURABLE_GROWTH_RUN_MANIFEST_CONFLICT');
    return { record: existing, manifest: structuredClone(existing.payload.manifest), economicsSummary: structuredClone(existing.payload.economicsSummary), idempotent: true };
  }
  const saved = await mutateAuthoritativeRuntimeState({ store, tenantId, recordType: GROWTH_RUN_MANIFEST_RECORD_TYPE, recordId: resolvedRunId, indexKey: action.actionId, payload, expectedRevision: 0, now, event: { eventId: `growth-run-manifest:${resolvedRunId}`, eventType: 'growth.run_manifest.persisted', payload: { runId: resolvedRunId, manifestHash: manifest.manifestHash, sourceProofHash, actionId: action.actionId, attemptId: attempt.attemptId, commandId: transportProof.command?.commandId ?? null, submissionResultCount: transportProof.results.length, outcomeCount: outcomeRecords.length, economicsEventCount: economicsRecords.length, actualCostUsd: economicsSummary.actualCostUsd, actualHumanMinutes: economicsSummary.actualHumanMinutes }, correlationId: resolvedRunId } });
  return { record: validateRecord(saved.record, tenantId), manifest, economicsSummary, idempotent: false };
}
