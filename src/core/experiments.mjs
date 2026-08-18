import { sha256Canonical } from './canonical.mjs';

export const EXPERIMENT_STATES = Object.freeze(['DRAFT','APPROVED','RUNNING','OBSERVING','COMPLETED','STOPPED','INCONCLUSIVE','RECONCILIATION_REQUIRED']);
export const EXPERIMENT_DECISIONS = Object.freeze(['CONTINUE','SUCCESS','FAILURE','INCONCLUSIVE','STOP_GUARDRAIL']);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function iso(value, label) {
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) throw new Error(`${label} must be a valid date/time.`);
  return d.toISOString();
}

function nonNegative(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number.`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function compare(value, operator, threshold) {
  if (operator === 'GTE') return value >= threshold;
  if (operator === 'GT') return value > threshold;
  if (operator === 'LTE') return value <= threshold;
  if (operator === 'LT') return value < threshold;
  if (operator === 'EQ') return value === threshold;
  throw new Error(`Unsupported criterion operator: ${operator}`);
}

export function experimentApprovalBody(experiment) {
  return {
    schemaVersion: experiment.schemaVersion,
    experimentId: experiment.experimentId,
    tenantId: experiment.tenantId,
    opportunityId: experiment.opportunityId,
    businessSnapshotId: experiment.businessSnapshotId,
    hypothesis: experiment.hypothesis,
    actionPlanRef: experiment.actionPlanRef,
    actionPlanHash: experiment.actionPlanHash,
    primaryMetric: experiment.primaryMetric,
    successCriterion: experiment.successCriterion,
    guardrails: experiment.guardrails,
    minimumSampleSize: experiment.minimumSampleSize,
    observationHorizonHours: experiment.observationHorizonHours,
    maxExposure: experiment.maxExposure,
    maxSpendUsd: experiment.maxSpendUsd
  };
}

export function experimentApprovalHash(experiment) {
  return sha256Canonical(experimentApprovalBody(experiment));
}

export function createExperiment(input) {
  const experiment = {
    schemaVersion: 1,
    experimentId: requiredString(input.experimentId, 'experimentId'),
    tenantId: requiredString(input.tenantId, 'tenantId'),
    opportunityId: requiredString(input.opportunityId, 'opportunityId'),
    businessSnapshotId: requiredString(input.businessSnapshotId, 'businessSnapshotId'),
    hypothesis: requiredString(input.hypothesis, 'hypothesis'),
    actionPlanRef: requiredString(input.actionPlanRef, 'actionPlanRef'),
    actionPlanHash: requiredString(input.actionPlanHash, 'actionPlanHash'),
    primaryMetric: requiredString(input.primaryMetric, 'primaryMetric'),
    successCriterion: {
      operator: requiredString(input.successCriterion?.operator, 'successCriterion.operator'),
      threshold: nonNegative(input.successCriterion?.threshold, 'successCriterion.threshold')
    },
    guardrails: Array.isArray(input.guardrails) ? input.guardrails.map((g, i) => ({
      metric: requiredString(g.metric, `guardrails[${i}].metric`),
      operator: requiredString(g.operator, `guardrails[${i}].operator`),
      threshold: nonNegative(g.threshold, `guardrails[${i}].threshold`)
    })) : [],
    minimumSampleSize: positiveInteger(input.minimumSampleSize, 'minimumSampleSize'),
    observationHorizonHours: positiveInteger(input.observationHorizonHours, 'observationHorizonHours'),
    maxExposure: positiveInteger(input.maxExposure, 'maxExposure'),
    maxSpendUsd: nonNegative(input.maxSpendUsd, 'maxSpendUsd'),
    state: 'DRAFT',
    createdAt: iso(input.createdAt ?? new Date(), 'createdAt'),
    approvalHash: null,
    approvedAt: null,
    approvedBy: null,
    startedAt: null,
    completedAt: null,
    closeDecision: null,
    closeReasons: []
  };
  if (!['GTE','GT','LTE','LT','EQ'].includes(experiment.successCriterion.operator)) throw new Error('Invalid success criterion operator.');
  for (const g of experiment.guardrails) if (!['GTE','GT','LTE','LT','EQ'].includes(g.operator)) throw new Error('Invalid guardrail operator.');
  return experiment;
}

export function approveExperiment(experiment, { actorId, now = new Date() }) {
  if (experiment.state !== 'DRAFT') throw new Error('EXPERIMENT_NOT_DRAFT');
  requiredString(actorId, 'actorId');
  const hash = experimentApprovalHash(experiment);
  return { ...structuredClone(experiment), state: 'APPROVED', approvalHash: hash, approvedAt: iso(now, 'now'), approvedBy: actorId };
}

export function assertExperimentIntegrity(experiment) {
  if (!experiment.approvalHash) throw new Error('EXPERIMENT_NOT_APPROVED');
  if (experiment.approvalHash !== experimentApprovalHash(experiment)) throw new Error('APPROVED_EXPERIMENT_CHANGED');
  return true;
}

export function startExperiment(experiment, { now = new Date() } = {}) {
  if (experiment.state !== 'APPROVED') throw new Error('EXPERIMENT_NOT_APPROVED');
  assertExperimentIntegrity(experiment);
  return { ...structuredClone(experiment), state: 'RUNNING', startedAt: iso(now, 'now') };
}

export function markExperimentObserving(experiment) {
  if (!['RUNNING','OBSERVING'].includes(experiment.state)) throw new Error('EXPERIMENT_NOT_RUNNING');
  return { ...structuredClone(experiment), state: 'OBSERVING' };
}

export function evaluateExperiment(experiment, observation, { now = new Date() } = {}) {
  if (!['RUNNING','OBSERVING'].includes(experiment.state)) throw new Error('EXPERIMENT_NOT_RUNNING');
  assertExperimentIntegrity(experiment);
  if (!observation || typeof observation !== 'object') throw new Error('observation is required.');
  const sampleSize = positiveInteger(observation.sampleSize, 'observation.sampleSize');
  const exposure = positiveInteger(observation.exposure, 'observation.exposure');
  const spendUsd = nonNegative(observation.spendUsd, 'observation.spendUsd');
  if (exposure > experiment.maxExposure) return { decision: 'STOP_GUARDRAIL', reasons: ['MAX_EXPOSURE_EXCEEDED'] };
  if (spendUsd > experiment.maxSpendUsd) return { decision: 'STOP_GUARDRAIL', reasons: ['MAX_SPEND_EXCEEDED'] };

  const metrics = observation.metrics ?? {};
  for (const guardrail of experiment.guardrails) {
    const value = metrics[guardrail.metric];
    if (typeof value === 'number' && compare(value, guardrail.operator, guardrail.threshold)) {
      return { decision: 'STOP_GUARDRAIL', reasons: [`GUARDRAIL_TRIGGERED:${guardrail.metric}`] };
    }
  }

  const startedAt = Date.parse(experiment.startedAt);
  const elapsedHours = (Date.parse(iso(now, 'now')) - startedAt) / 36e5;
  if (sampleSize < experiment.minimumSampleSize || elapsedHours < experiment.observationHorizonHours) {
    return { decision: 'CONTINUE', reasons: ['MINIMUM_EVIDENCE_NOT_REACHED'] };
  }

  const primary = metrics[experiment.primaryMetric];
  if (typeof primary !== 'number' || !Number.isFinite(primary)) return { decision: 'INCONCLUSIVE', reasons: ['PRIMARY_METRIC_UNAVAILABLE'] };
  return compare(primary, experiment.successCriterion.operator, experiment.successCriterion.threshold)
    ? { decision: 'SUCCESS', reasons: ['SUCCESS_CRITERION_MET'] }
    : { decision: 'FAILURE', reasons: ['SUCCESS_CRITERION_NOT_MET'] };
}

export function closeExperiment(experiment, evaluation, { now = new Date() } = {}) {
  if (!EXPERIMENT_DECISIONS.includes(evaluation?.decision) || evaluation.decision === 'CONTINUE') throw new Error('EXPERIMENT_NOT_READY_TO_CLOSE');
  const state = evaluation.decision === 'SUCCESS' || evaluation.decision === 'FAILURE' ? 'COMPLETED'
    : evaluation.decision === 'INCONCLUSIVE' ? 'INCONCLUSIVE'
    : 'STOPPED';
  return {
    ...structuredClone(experiment),
    state,
    completedAt: iso(now, 'now'),
    closeDecision: evaluation.decision,
    closeReasons: [...evaluation.reasons]
  };
}

export function markExperimentReconciliationRequired(experiment, reason) {
  requiredString(reason, 'reason');
  if (!['RUNNING','OBSERVING'].includes(experiment.state)) throw new Error('EXPERIMENT_NOT_RUNNING');
  return { ...structuredClone(experiment), state: 'RECONCILIATION_REQUIRED', closeReasons: [reason] };
}
