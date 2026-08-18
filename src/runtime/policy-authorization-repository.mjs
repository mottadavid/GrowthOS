import { actionApprovalHash, sha256Canonical } from '../core/canonical.mjs';
import { evaluateActionPolicy } from '../core/control-plane.mjs';
import {
  createPolicyDecisionReceipt,
  validatePolicyDecisionReceipt,
  assertPolicyReceiptMatches,
  envelopeAuthorityHash
} from '../core/policy-receipts.mjs';
import { validateActionRequest, validateActionEnvelope, validateBusinessState } from '../core/validators.mjs';
import { mutateAuthoritativeRuntimeState } from './atomic-store.mjs';

export const POLICY_AUTHORIZATION_RECORD_TYPE = 'policy_authorization';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function businessStateProof(businessState) {
  if (!businessState) return { hash: null, summary: null };
  validateBusinessState(businessState);
  return {
    hash: sha256Canonical(businessState),
    summary: {
      tenantId: businessState.tenantId,
      completeness: businessState.completeness,
      capacity: {
        status: businessState.capacity.status,
        demandThrottleRecommended: businessState.capacity.demandThrottleRecommended === true
      }
    }
  };
}

function validateBundle(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw new Error('policy authorization bundle must be an object.');
  if (bundle.schemaVersion !== 1) throw new Error('Unsupported policy authorization schemaVersion.');
  requiredString(bundle.tenantId, 'bundle.tenantId');
  validateActionRequest(bundle.action);
  validateActionEnvelope(bundle.envelope);
  validatePolicyDecisionReceipt(bundle.receipt);
  if (bundle.action.tenantId !== bundle.tenantId || bundle.envelope.tenantId !== bundle.tenantId || bundle.receipt.tenantId !== bundle.tenantId) {
    throw new Error('DURABLE_POLICY_AUTHORIZATION_TENANT_MISMATCH');
  }
  if (bundle.action.actionId !== bundle.receipt.actionId) throw new Error('DURABLE_POLICY_AUTHORIZATION_ACTION_MISMATCH');
  if (bundle.actionHash !== actionApprovalHash(bundle.action) || bundle.actionHash !== bundle.receipt.actionHash) {
    throw new Error('DURABLE_POLICY_AUTHORIZATION_ACTION_HASH_MISMATCH');
  }
  if (
    bundle.envelopeId !== bundle.envelope.envelopeId ||
    bundle.envelopeId !== bundle.receipt.envelopeId ||
    bundle.envelopeHash !== envelopeAuthorityHash(bundle.envelope) ||
    bundle.envelopeHash !== bundle.receipt.envelopeHash
  ) {
    throw new Error('DURABLE_POLICY_AUTHORIZATION_ENVELOPE_MISMATCH');
  }
  if (bundle.businessStateHash !== null && !/^[0-9a-f]{64}$/.test(bundle.businessStateHash || '')) {
    throw new Error('bundle.businessStateHash must be null or SHA-256 hex.');
  }
  return bundle;
}

function validateRecord(record, tenantId) {
  validateBundle(record.payload);
  if (
    record.tenantId !== tenantId ||
    record.recordId !== record.payload.receipt.receiptId ||
    record.indexKey !== record.payload.action.actionId
  ) {
    throw new Error('DURABLE_POLICY_AUTHORIZATION_IDENTITY_MISMATCH');
  }
  return record;
}

function eventPayload(bundle) {
  return {
    receiptId: bundle.receipt.receiptId,
    receiptHash: bundle.receipt.receiptHash,
    actionId: bundle.action.actionId,
    actionHash: bundle.actionHash,
    envelopeId: bundle.envelopeId,
    envelopeHash: bundle.envelopeHash,
    decision: bundle.receipt.decision,
    reasons: [...bundle.receipt.reasons],
    businessStateHash: bundle.businessStateHash,
    summary: clone(bundle.receipt.summary)
  };
}

export async function loadDurablePolicyAuthorization({ store, tenantId, receiptId }) {
  requiredString(tenantId, 'tenantId');
  requiredString(receiptId, 'receiptId');
  const record = await store.getRecord({
    tenantId,
    recordType: POLICY_AUTHORIZATION_RECORD_TYPE,
    recordId: receiptId
  });
  if (!record) return null;
  return validateRecord(record, tenantId);
}

export async function listDurablePolicyAuthorizations({ store, tenantId, actionId, limit = 1000 }) {
  requiredString(tenantId, 'tenantId');
  requiredString(actionId, 'actionId');
  const records = await store.listRecords({
    tenantId,
    recordType: POLICY_AUTHORIZATION_RECORD_TYPE,
    indexKey: actionId,
    limit
  });
  return records.map(record => validateRecord(record, tenantId));
}

export async function evaluateAndPersistPolicyAuthorization({
  store,
  action,
  envelope,
  businessState = null,
  now = new Date(),
  receiptId = null
}) {
  validateActionRequest(action);
  validateActionEnvelope(envelope);
  validateBusinessState(businessState);

  const decision = evaluateActionPolicy({ action, envelope, businessState, now });
  const receipt = createPolicyDecisionReceipt({ action, envelope, decision, evaluatedAt: now, receiptId });
  assertPolicyReceiptMatches({ receipt, action, envelope });
  const proof = businessStateProof(businessState);
  const bundle = {
    schemaVersion: 1,
    tenantId: action.tenantId,
    action: clone(action),
    actionHash: actionApprovalHash(action),
    envelope: clone(envelope),
    envelopeId: envelope.envelopeId,
    envelopeHash: receipt.envelopeHash,
    businessStateHash: proof.hash,
    businessStateSummary: proof.summary,
    receipt: clone(receipt)
  };
  validateBundle(bundle);

  const existing = await loadDurablePolicyAuthorization({
    store,
    tenantId: action.tenantId,
    receiptId: receipt.receiptId
  });
  if (existing) {
    if (sha256Canonical(existing.payload) !== sha256Canonical(bundle)) {
      throw new Error('DURABLE_POLICY_AUTHORIZATION_RECEIPT_ID_CONFLICT');
    }
    return { record: existing, decision, idempotent: true };
  }

  const result = await mutateAuthoritativeRuntimeState({
    store,
    tenantId: action.tenantId,
    recordType: POLICY_AUTHORIZATION_RECORD_TYPE,
    recordId: receipt.receiptId,
    indexKey: action.actionId,
    payload: bundle,
    expectedRevision: 0,
    now,
    event: {
      eventId: `policy-authorization:${receipt.receiptId}`,
      eventType: 'growth.policy.authorization_recorded',
      payload: eventPayload(bundle),
      correlationId: action.actionId
    }
  });
  return { record: validateRecord(result.record, action.tenantId), decision, idempotent: false };
}

export function assertDurablePolicyAuthorizationMatches({ record, action, envelope }) {
  validateRecord(record, action?.tenantId);
  assertPolicyReceiptMatches({ receipt: record.payload.receipt, action, envelope });
  if (record.payload.actionHash !== actionApprovalHash(action)) throw new Error('DURABLE_POLICY_AUTHORIZATION_ACTION_CHANGED');
  if (sha256Canonical(record.payload.action) !== sha256Canonical(action)) throw new Error('DURABLE_POLICY_AUTHORIZATION_ACTION_PAYLOAD_CHANGED');
  if (sha256Canonical(record.payload.envelope) !== sha256Canonical(envelope)) throw new Error('DURABLE_POLICY_AUTHORIZATION_ENVELOPE_PAYLOAD_CHANGED');
  return true;
}
