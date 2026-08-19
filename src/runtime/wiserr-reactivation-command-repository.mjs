import { sha256Canonical } from '../core/canonical.mjs';
import { validateWiserrReactivationCommand } from '../reactivation/wiserr-command.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const WISERR_REACTIVATION_COMMAND_RECORD_TYPE = 'wiserr_reactivation_command';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function semanticHash(command) {
  validateWiserrReactivationCommand(command);
  return sha256Canonical(command);
}

function validateRecord(record, tenantId) {
  if (!record || typeof record !== 'object') throw new Error('durable Wiserr command record is required.');
  const payload = record.payload;
  if (!payload || payload.schemaVersion !== 1) throw new Error('Invalid durable Wiserr command payload.');
  validateWiserrReactivationCommand(payload.command);
  if (!/^[0-9a-f]{64}$/.test(payload.commandSemanticHash || '')) throw new Error('payload.commandSemanticHash must be SHA-256 hex.');
  if (semanticHash(payload.command) !== payload.commandSemanticHash) throw new Error('DURABLE_WISERR_COMMAND_SEMANTIC_HASH_MISMATCH');
  if (
    record.tenantId !== tenantId ||
    payload.command.tenantId !== tenantId ||
    record.recordId !== payload.command.commandId ||
    record.indexKey !== payload.command.actionId
  ) {
    throw new Error('DURABLE_WISERR_COMMAND_IDENTITY_MISMATCH');
  }
  return record;
}

export async function loadDurableWiserrReactivationCommand({ store, tenantId, commandId }) {
  requiredString(tenantId, 'tenantId');
  requiredString(commandId, 'commandId');
  const record = await store.getRecord({
    tenantId,
    recordType: WISERR_REACTIVATION_COMMAND_RECORD_TYPE,
    recordId: commandId
  });
  return record ? validateRecord(record, tenantId) : null;
}

export async function listDurableWiserrReactivationCommands({ store, tenantId, actionId, limit = 1000 }) {
  requiredString(tenantId, 'tenantId');
  requiredString(actionId, 'actionId');
  const records = await store.listRecords({
    tenantId,
    recordType: WISERR_REACTIVATION_COMMAND_RECORD_TYPE,
    indexKey: actionId,
    limit
  });
  return records.map(record => validateRecord(record, tenantId));
}

export async function persistDurableWiserrReactivationCommand({ store, command, now = new Date() }) {
  validateWiserrReactivationCommand(command);
  const commandSemanticHash = semanticHash(command);
  const existing = await loadDurableWiserrReactivationCommand({
    store,
    tenantId: command.tenantId,
    commandId: command.commandId
  });
  if (existing) {
    if (existing.payload.commandSemanticHash !== commandSemanticHash) throw new Error('DURABLE_WISERR_COMMAND_CONFLICT');
    return { record: existing, idempotent: true };
  }

  const payload = {
    schemaVersion: 1,
    command: clone(command),
    commandSemanticHash
  };

  try {
    const saved = await mutateAuthoritativeRuntimeState({
      store,
      tenantId: command.tenantId,
      recordType: WISERR_REACTIVATION_COMMAND_RECORD_TYPE,
      recordId: command.commandId,
      indexKey: command.actionId,
      payload,
      expectedRevision: 0,
      now,
      event: {
        eventId: `wiserr-reactivation-command:${command.commandId}`,
        eventType: 'growth.wiserr_reactivation_command.persisted',
        correlationId: command.actionId,
        payload: {
          commandId: command.commandId,
          commandHash: command.commandHash,
          commandSemanticHash,
          actionId: command.actionId,
          campaignId: command.campaignId,
          attemptId: command.attemptId,
          attemptNumber: command.attemptNumber,
          capacityBundleId: command.capacityBundleId,
          capacityProofHash: command.capacityProofHash,
          executionAuthorityDependencyId: command.executionAuthorityDependencyId,
          executionAuthorityLockFingerprint: command.executionAuthorityLockFingerprint,
          maxRecipients: command.maxRecipients
        }
      }
    });
    return { record: validateRecord(saved.record, command.tenantId), idempotent: false };
  } catch (error) {
    if (error?.code !== 'RUNTIME_RECORD_REVISION_CONFLICT') throw error;
    const raced = await loadDurableWiserrReactivationCommand({ store, tenantId: command.tenantId, commandId: command.commandId });
    if (!raced || raced.payload.commandSemanticHash !== commandSemanticHash) throw error;
    return { record: raced, idempotent: true };
  }
}

export function assertDurableWiserrReactivationCommandMatches(record, command) {
  validateRecord(record, record.tenantId);
  validateWiserrReactivationCommand(command);
  if (record.payload.commandSemanticHash !== semanticHash(command)) throw new Error('DURABLE_WISERR_COMMAND_CHANGED');
  return true;
}
