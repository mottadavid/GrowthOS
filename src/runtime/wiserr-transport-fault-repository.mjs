import { sha256Canonical } from '../core/canonical.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const WISERR_TRANSPORT_FAULT_RECORD_TYPE = 'wiserr_transport_fault';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function validIso(value, label) {
  requiredString(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid date-time.`);
  return value;
}

export function wiserrTransportFaultId(attemptId) {
  return `wiserr-transport-fault:${requiredString(attemptId, 'attemptId')}`;
}

export function wiserrTransportFaultEvidenceRef(faultId) {
  return `growthos://wiserr-transport-fault/${encodeURIComponent(requiredString(faultId, 'faultId'))}`;
}

function semanticBody(fault) {
  return {
    schemaVersion: fault.schemaVersion,
    faultId: fault.faultId,
    tenantId: fault.tenantId,
    commandId: fault.commandId,
    attemptId: fault.attemptId,
    phase: fault.phase,
    errorName: fault.errorName,
    errorCode: fault.errorCode,
    occurredAt: fault.occurredAt
  };
}

export function wiserrTransportFaultSemanticHash(fault) {
  return sha256Canonical(semanticBody(fault));
}

function validateFault(fault) {
  if (!fault || typeof fault !== 'object' || Array.isArray(fault)) throw new Error('fault must be an object.');
  if (fault.schemaVersion !== 1) throw new Error('Unsupported fault.schemaVersion.');
  for (const field of ['faultId','tenantId','commandId','attemptId','phase','errorName','errorCode','occurredAt','semanticHash']) requiredString(fault[field], `fault.${field}`);
  validIso(fault.occurredAt, 'fault.occurredAt');
  if (!/^[0-9a-f]{64}$/.test(fault.semanticHash)) throw new Error('fault.semanticHash must be SHA-256 hex.');
  if (fault.semanticHash !== wiserrTransportFaultSemanticHash(fault)) throw new Error('WISERR_TRANSPORT_FAULT_HASH_MISMATCH');
  if (Object.hasOwn(fault, 'message') || Object.hasOwn(fault, 'stack') || Object.hasOwn(fault, 'providerPayload') || Object.hasOwn(fault, 'command')) {
    throw new Error('Transport fault evidence must not embed raw error/message/provider/command payloads.');
  }
  return fault;
}

function validateRecord(record, tenantId) {
  validateFault(record.payload);
  if (record.tenantId !== tenantId || record.payload.tenantId !== tenantId || record.recordId !== record.payload.faultId || record.indexKey !== record.payload.attemptId) {
    throw new Error('DURABLE_WISERR_TRANSPORT_FAULT_IDENTITY_MISMATCH');
  }
  return record;
}

export async function loadDurableWiserrTransportFault({ store, tenantId, faultId }) {
  requiredString(tenantId, 'tenantId'); requiredString(faultId, 'faultId');
  const record = await store.getRecord({ tenantId, recordType: WISERR_TRANSPORT_FAULT_RECORD_TYPE, recordId: faultId });
  return record ? validateRecord(record, tenantId) : null;
}

export async function persistDurableWiserrTransportFault({ store, tenantId, commandId, attemptId, error, now = new Date() }) {
  requiredString(tenantId, 'tenantId'); requiredString(commandId, 'commandId'); requiredString(attemptId, 'attemptId');
  const occurredAt = (now instanceof Date ? now : new Date(now)).toISOString();
  const faultId = wiserrTransportFaultId(attemptId);
  const body = {
    schemaVersion: 1,
    faultId,
    tenantId,
    commandId,
    attemptId,
    phase: 'TRANSPORT_CALL',
    errorName: typeof error?.name === 'string' && error.name.trim() ? error.name.trim() : 'Error',
    errorCode: typeof error?.code === 'string' && error.code.trim() ? error.code.trim() : 'UNCLASSIFIED_TRANSPORT_ERROR',
    occurredAt
  };
  const fault = { ...body, semanticHash: sha256Canonical(body) };
  validateFault(fault);
  const existing = await loadDurableWiserrTransportFault({ store, tenantId, faultId });
  if (existing) {
    if (existing.payload.semanticHash !== fault.semanticHash) throw new Error('DURABLE_WISERR_TRANSPORT_FAULT_CONFLICT');
    return { record: existing, idempotent: true, evidenceRef: wiserrTransportFaultEvidenceRef(faultId) };
  }
  const saved = await mutateAuthoritativeRuntimeState({
    store, tenantId, recordType: WISERR_TRANSPORT_FAULT_RECORD_TYPE, recordId: faultId, indexKey: attemptId,
    payload: fault, expectedRevision: 0, now,
    event: { eventId: `wiserr-transport-fault:${attemptId}`, eventType: 'growth.wiserr_transport_fault.recorded', correlationId: attemptId, payload: { faultId, commandId, attemptId, errorName: fault.errorName, errorCode: fault.errorCode, semanticHash: fault.semanticHash } }
  });
  return { record: validateRecord(saved.record, tenantId), idempotent: false, evidenceRef: wiserrTransportFaultEvidenceRef(faultId) };
}
