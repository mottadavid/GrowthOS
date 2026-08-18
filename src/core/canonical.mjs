import crypto from 'node:crypto';

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
  return out;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Canonical(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function approvalBoundAction(action) {
  return {
    schemaVersion: action.schemaVersion,
    tenantId: action.tenantId,
    actionFamily: action.actionFamily,
    actionType: action.actionType,
    channel: action.channel ?? null,
    accountId: action.accountId ?? null,
    geography: action.geography ?? null,
    businessSnapshotId: action.businessSnapshotId ?? null,
    opportunityId: action.opportunityId ?? null,
    experimentId: action.experimentId ?? null,
    inputs: action.inputs,
    expectedCost: action.expectedCost,
    changePercent: action.changePercent ?? null
  };
}

export function actionApprovalHash(action) {
  return sha256Canonical(approvalBoundAction(action));
}
