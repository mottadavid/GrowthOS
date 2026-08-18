import { EXECUTION_ATTEMPT_STATES } from '../core/execution-attempts.mjs';

const SCAN_LIMIT = 10000;
const CAMPAIGN_RECORD_TYPE = 'reactivation_campaign';
const EXPERIMENT_RECORD_TYPE = 'experiment';
const ENVELOPE_RECORD_TYPE = 'action_envelope';
const ATTEMPT_RECORD_TYPE = 'execution_attempt';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function validNow(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('now must be a valid date/time.');
  return date;
}

function finding({ severity, code, recordType, recordId, state, actionId = null, details = {} }) {
  return { severity, code, recordType, recordId, state, actionId, details };
}

async function scan(store, tenantId, recordType) {
  const records = await store.listRecords({ tenantId, recordType, limit: SCAN_LIMIT });
  return {
    records,
    potentiallyTruncated: records.length === SCAN_LIMIT
  };
}

export async function buildTenantRecoveryReport({ store, tenantId, now = new Date() }) {
  if (!store || typeof store.listRecords !== 'function') throw new Error('store with listRecords() is required.');
  requiredString(tenantId, 'tenantId');
  const current = validNow(now);

  const [attempts, campaigns, experiments, envelopes] = await Promise.all([
    scan(store, tenantId, ATTEMPT_RECORD_TYPE),
    scan(store, tenantId, CAMPAIGN_RECORD_TYPE),
    scan(store, tenantId, EXPERIMENT_RECORD_TYPE),
    scan(store, tenantId, ENVELOPE_RECORD_TYPE)
  ]);

  const findings = [];

  for (const record of attempts.records) {
    const attempt = record.payload;
    const base = { recordType: ATTEMPT_RECORD_TYPE, recordId: record.recordId, state: attempt?.state ?? 'UNKNOWN', actionId: attempt?.actionId ?? null };
    if (attempt?.state === EXECUTION_ATTEMPT_STATES.CREATED) {
      findings.push(finding({ ...base, severity: 'ATTENTION', code: 'ATTEMPT_CREATED_REVALIDATE_BEFORE_SUBMIT' }));
    } else if (attempt?.state === EXECUTION_ATTEMPT_STATES.SUBMITTING) {
      findings.push(finding({ ...base, severity: 'BLOCKING', code: 'ATTEMPT_SUBMITTING_OUTCOME_UNKNOWN' }));
    } else if (attempt?.state === EXECUTION_ATTEMPT_STATES.ACCEPTED) {
      findings.push(finding({ ...base, severity: 'BLOCKING', code: 'ATTEMPT_ACCEPTED_NOT_FINAL' }));
    } else if (attempt?.state === EXECUTION_ATTEMPT_STATES.RECONCILIATION_REQUIRED) {
      findings.push(finding({ ...base, severity: 'BLOCKING', code: 'ATTEMPT_RECONCILIATION_REQUIRED' }));
    }
  }

  for (const record of campaigns.records) {
    const campaign = record.payload;
    if (campaign?.status === 'EXECUTING') {
      findings.push(finding({ severity: 'BLOCKING', code: 'CAMPAIGN_EXECUTING_VERIFY_ATTEMPT', recordType: CAMPAIGN_RECORD_TYPE, recordId: record.recordId, state: campaign.status, details: { attemptIds: [...(campaign.attemptIds || [])] } }));
    } else if (campaign?.status === 'RECONCILIATION_REQUIRED') {
      findings.push(finding({ severity: 'BLOCKING', code: 'CAMPAIGN_RECONCILIATION_REQUIRED', recordType: CAMPAIGN_RECORD_TYPE, recordId: record.recordId, state: campaign.status }));
    } else if (campaign?.status === 'APPROVED') {
      findings.push(finding({ severity: 'ATTENTION', code: 'CAMPAIGN_APPROVED_REVALIDATE_BEFORE_EXECUTION', recordType: CAMPAIGN_RECORD_TYPE, recordId: record.recordId, state: campaign.status }));
    } else if (campaign?.status === 'OBSERVING') {
      findings.push(finding({ severity: 'ATTENTION', code: 'CAMPAIGN_OBSERVATION_PENDING', recordType: CAMPAIGN_RECORD_TYPE, recordId: record.recordId, state: campaign.status }));
    }
  }

  for (const record of experiments.records) {
    const experiment = record.payload;
    if (experiment?.state === 'RECONCILIATION_REQUIRED') {
      findings.push(finding({ severity: 'BLOCKING', code: 'EXPERIMENT_RECONCILIATION_REQUIRED', recordType: EXPERIMENT_RECORD_TYPE, recordId: record.recordId, state: experiment.state }));
    } else if (['RUNNING', 'OBSERVING'].includes(experiment?.state)) {
      findings.push(finding({ severity: 'ATTENTION', code: 'EXPERIMENT_EVIDENCE_WINDOW_OPEN', recordType: EXPERIMENT_RECORD_TYPE, recordId: record.recordId, state: experiment.state }));
    }
  }

  for (const record of envelopes.records) {
    const envelope = record.payload;
    if (envelope?.status === 'ACTIVE' && Number.isFinite(Date.parse(envelope.validUntil)) && current.getTime() > Date.parse(envelope.validUntil)) {
      findings.push(finding({ severity: 'ATTENTION', code: 'ACTIVE_ENVELOPE_PAST_VALID_UNTIL', recordType: ENVELOPE_RECORD_TYPE, recordId: record.recordId, state: envelope.status, details: { validUntil: envelope.validUntil } }));
    }
  }

  const coverage = {
    scanLimit: SCAN_LIMIT,
    potentiallyTruncatedRecordTypes: [
      [ATTEMPT_RECORD_TYPE, attempts],
      [CAMPAIGN_RECORD_TYPE, campaigns],
      [EXPERIMENT_RECORD_TYPE, experiments],
      [ENVELOPE_RECORD_TYPE, envelopes]
    ].filter(([, result]) => result.potentiallyTruncated).map(([recordType]) => recordType)
  };
  const coverageComplete = coverage.potentiallyTruncatedRecordTypes.length === 0;
  const blockingCount = findings.filter(item => item.severity === 'BLOCKING').length;
  const attentionCount = findings.filter(item => item.severity === 'ATTENTION').length;
  const unresolvedAttemptCount = findings.filter(item => item.recordType === ATTEMPT_RECORD_TYPE).length;

  return {
    schemaVersion: 1,
    tenantId,
    evaluatedAt: current.toISOString(),
    mode: 'READ_ONLY',
    safeForUnattendedRecovery: coverageComplete && blockingCount === 0 && unresolvedAttemptCount === 0,
    requiresHumanOrDeterministicRevalidation: !coverageComplete || findings.length > 0,
    summary: {
      blockingCount,
      attentionCount,
      unresolvedAttemptCount,
      findingCount: findings.length
    },
    coverage,
    findings
  };
}
