import { inspectRuntimeDatabase } from './database-certification.mjs';
import { buildTenantRecoveryReport } from './recovery-report.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

export function evaluateStartupReadiness({ databaseReport = null, recoveryReport = null, inspectionErrors = [] }) {
  const blockers = [];
  for (const error of inspectionErrors || []) {
    if (typeof error === 'string' && error.trim()) blockers.push(error);
  }

  if (!databaseReport) blockers.push('DATABASE_REPORT_UNAVAILABLE');
  else if (databaseReport.ready !== true) {
    blockers.push('DATABASE_NOT_READY');
    for (const issue of databaseReport.issues || []) blockers.push(`DATABASE:${issue}`);
  }

  if (!recoveryReport) blockers.push('RECOVERY_REPORT_UNAVAILABLE');
  else if (recoveryReport.safeForUnattendedRecovery !== true) {
    blockers.push('RUNTIME_RECOVERY_NOT_CLEAN');
    if (recoveryReport.coverage?.potentiallyTruncatedRecordTypes?.length) blockers.push('RUNTIME_RECOVERY_COVERAGE_INCOMPLETE');
    for (const finding of recoveryReport.findings || []) blockers.push(`RECOVERY:${finding.code}`);
  }

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    mode: 'READ_ONLY',
    databaseReady: databaseReport?.ready === true,
    recoveryReady: recoveryReport?.safeForUnattendedRecovery === true
  };
}

export async function inspectTenantStartupReadiness({
  pool,
  store,
  tenantId,
  now = new Date(),
  migrationDirectory
}) {
  requiredString(tenantId, 'tenantId');
  const inspectionErrors = [];
  let databaseReport = null;
  let recoveryReport = null;

  try {
    databaseReport = await inspectRuntimeDatabase({
      pool,
      ...(migrationDirectory ? { directory: migrationDirectory } : {})
    });
  } catch (error) {
    inspectionErrors.push(`DATABASE_INSPECTION_FAILED:${String(error?.message || error)}`);
  }

  try {
    recoveryReport = await buildTenantRecoveryReport({ store, tenantId, now });
  } catch (error) {
    inspectionErrors.push(`RECOVERY_INSPECTION_FAILED:${String(error?.message || error)}`);
  }

  const evaluation = evaluateStartupReadiness({ databaseReport, recoveryReport, inspectionErrors });
  return {
    schemaVersion: 1,
    tenantId,
    evaluatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    ...evaluation,
    databaseReport,
    recoveryReport
  };
}

export async function assertTenantStartupReady(input) {
  const report = await inspectTenantStartupReadiness(input);
  if (!report.ready) {
    const error = new Error(`GROWTHOS_STARTUP_NOT_READY:${report.blockers.join(',')}`);
    error.report = report;
    throw error;
  }
  return report;
}
