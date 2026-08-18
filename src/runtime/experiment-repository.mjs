import { sha256Canonical } from '../core/canonical.mjs';
import {
  EXPERIMENT_STATES,
  createExperiment,
  approveExperiment,
  assertExperimentIntegrity,
  startExperiment,
  markExperimentObserving,
  evaluateExperiment,
  closeExperiment,
  markExperimentReconciliationRequired
} from '../core/experiments.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const EXPERIMENT_RECORD_TYPE = 'experiment';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function validateExperimentPayload(experiment) {
  if (!experiment || typeof experiment !== 'object' || Array.isArray(experiment)) throw new Error('experiment payload must be an object.');
  requiredString(experiment.experimentId, 'experiment.experimentId');
  requiredString(experiment.tenantId, 'experiment.tenantId');
  requiredString(experiment.actionPlanRef, 'experiment.actionPlanRef');
  if (!/^[0-9a-f]{64}$/.test(experiment.actionPlanHash || '')) throw new Error('experiment.actionPlanHash must be SHA-256 hex.');
  if (!EXPERIMENT_STATES.includes(experiment.state)) throw new Error('Invalid experiment.state.');
  if (experiment.state !== 'DRAFT') assertExperimentIntegrity(experiment);
  return experiment;
}

function validateExperimentRecord(record, tenantId) {
  validateExperimentPayload(record.payload);
  if (
    record.tenantId !== tenantId ||
    record.payload.tenantId !== tenantId ||
    record.recordId !== record.payload.experimentId ||
    record.indexKey !== record.payload.actionPlanHash
  ) {
    throw new Error('DURABLE_EXPERIMENT_IDENTITY_MISMATCH');
  }
  return record;
}

function eventIdFor(experiment, revision) {
  return `experiment:${experiment.experimentId}:revision:${revision}:${experiment.state}`;
}

function eventTypeFor(experiment) {
  return `growth.experiment.${String(experiment.state).toLowerCase()}`;
}

function eventPayload(experiment, extra = {}) {
  return {
    experimentId: experiment.experimentId,
    opportunityId: experiment.opportunityId,
    businessSnapshotId: experiment.businessSnapshotId,
    actionPlanRef: experiment.actionPlanRef,
    actionPlanHash: experiment.actionPlanHash,
    state: experiment.state,
    approvalHash: experiment.approvalHash ?? null,
    closeDecision: experiment.closeDecision ?? null,
    ...clone(extra)
  };
}

export async function loadDurableExperiment({ store, tenantId, experimentId }) {
  requiredString(tenantId, 'tenantId');
  requiredString(experimentId, 'experimentId');
  const record = await store.getRecord({ tenantId, recordType: EXPERIMENT_RECORD_TYPE, recordId: experimentId });
  if (!record) return null;
  return validateExperimentRecord(record, tenantId);
}

export async function listDurableExperiments({ store, tenantId, actionPlanHash, limit = 1000 }) {
  requiredString(tenantId, 'tenantId');
  requiredString(actionPlanHash, 'actionPlanHash');
  if (!/^[0-9a-f]{64}$/.test(actionPlanHash)) throw new Error('actionPlanHash must be SHA-256 hex.');
  const records = await store.listRecords({
    tenantId,
    recordType: EXPERIMENT_RECORD_TYPE,
    indexKey: actionPlanHash,
    limit
  });
  return records.map(record => validateExperimentRecord(record, tenantId));
}

export async function createDurableExperiment({ store, input, now = new Date() }) {
  const experiment = input?.state === 'DRAFT' ? validateExperimentPayload(clone(input)) : createExperiment({ ...input, createdAt: input?.createdAt ?? now });
  const existing = await loadDurableExperiment({ store, tenantId: experiment.tenantId, experimentId: experiment.experimentId });
  if (existing) {
    if (sha256Canonical(existing.payload) !== sha256Canonical(experiment)) throw new Error('DURABLE_EXPERIMENT_ID_CONFLICT');
    return { record: existing, idempotent: true };
  }

  const result = await mutateAuthoritativeRuntimeState({
    store,
    tenantId: experiment.tenantId,
    recordType: EXPERIMENT_RECORD_TYPE,
    recordId: experiment.experimentId,
    indexKey: experiment.actionPlanHash,
    payload: experiment,
    expectedRevision: 0,
    now,
    event: {
      eventId: eventIdFor(experiment, 1),
      eventType: eventTypeFor(experiment),
      payload: eventPayload(experiment),
      correlationId: experiment.experimentId
    }
  });
  return { record: validateExperimentRecord(result.record, experiment.tenantId), idempotent: false };
}

async function transition({ store, tenantId, experimentId, now = new Date(), apply, eventExtra = {} }) {
  const current = await loadDurableExperiment({ store, tenantId, experimentId });
  if (!current) throw new Error('DURABLE_EXPERIMENT_NOT_FOUND');
  const next = apply(clone(current.payload));
  validateExperimentPayload(next);
  if (
    next.experimentId !== current.payload.experimentId ||
    next.tenantId !== current.payload.tenantId ||
    next.actionPlanRef !== current.payload.actionPlanRef ||
    next.actionPlanHash !== current.payload.actionPlanHash
  ) {
    throw new Error('DURABLE_EXPERIMENT_IDENTITY_CHANGED');
  }
  const revision = current.revision + 1;
  const result = await mutateAuthoritativeRuntimeState({
    store,
    tenantId,
    recordType: EXPERIMENT_RECORD_TYPE,
    recordId: experimentId,
    indexKey: next.actionPlanHash,
    payload: next,
    expectedRevision: current.revision,
    now,
    event: {
      eventId: eventIdFor(next, revision),
      eventType: eventTypeFor(next),
      payload: eventPayload(next, eventExtra),
      correlationId: experimentId
    }
  });
  return validateExperimentRecord(result.record, tenantId);
}

export function approveDurableExperiment({ store, tenantId, experimentId, actorId, approvalAuthorityRef, now = new Date() }) {
  requiredString(approvalAuthorityRef, 'approvalAuthorityRef');
  return transition({
    store,
    tenantId,
    experimentId,
    now,
    apply: experiment => approveExperiment(experiment, { actorId, approvalAuthorityRef, now }),
    eventExtra: { approvedBy: actorId, approvalAuthorityRef }
  });
}

export function startDurableExperiment({ store, tenantId, experimentId, now = new Date() }) {
  return transition({
    store,
    tenantId,
    experimentId,
    now,
    apply: experiment => startExperiment(experiment, { now })
  });
}

export function markDurableExperimentObserving({ store, tenantId, experimentId, now = new Date() }) {
  return transition({
    store,
    tenantId,
    experimentId,
    now,
    apply: experiment => markExperimentObserving(experiment)
  });
}

export async function evaluateDurableExperiment({ store, tenantId, experimentId, observation, now = new Date() }) {
  const record = await loadDurableExperiment({ store, tenantId, experimentId });
  if (!record) throw new Error('DURABLE_EXPERIMENT_NOT_FOUND');
  return { record, evaluation: evaluateExperiment(record.payload, observation, { now }) };
}

export async function evaluateAndCloseDurableExperiment({ store, tenantId, experimentId, observation, now = new Date() }) {
  const current = await loadDurableExperiment({ store, tenantId, experimentId });
  if (!current) throw new Error('DURABLE_EXPERIMENT_NOT_FOUND');
  const evaluation = evaluateExperiment(current.payload, observation, { now });
  if (evaluation.decision === 'CONTINUE') return { record: current, evaluation, closed: false };

  const record = await transition({
    store,
    tenantId,
    experimentId,
    now,
    apply: experiment => closeExperiment(experiment, evaluation, { now }),
    eventExtra: {
      evaluationDecision: evaluation.decision,
      evidenceRefs: [...evaluation.evidenceRefs]
    }
  });
  return { record, evaluation, closed: true };
}

export function markDurableExperimentReconciliationRequired({ store, tenantId, experimentId, reason, now = new Date() }) {
  requiredString(reason, 'reason');
  return transition({
    store,
    tenantId,
    experimentId,
    now,
    apply: experiment => markExperimentReconciliationRequired(experiment, reason),
    eventExtra: { reconciliationReason: reason }
  });
}
