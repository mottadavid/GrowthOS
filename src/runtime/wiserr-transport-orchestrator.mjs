import { preparePersistedWiserrReactivationSubmission } from './wiserr-submission-preparation.mjs';
import {
  validateWiserrSubmissionResult
} from './wiserr-submission-result-ingestion.mjs';
import {
  ingestWiserrReactivationSubmissionResultAndAdvanceCampaign
} from './wiserr-submission-campaign-coordinator.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function reconciliationError(error, prepared) {
  const wrapped = new Error('WISERR_TRANSPORT_OUTCOME_REQUIRES_RECONCILIATION');
  wrapped.code = 'WISERR_TRANSPORT_OUTCOME_REQUIRES_RECONCILIATION';
  wrapped.requiresReconciliation = true;
  wrapped.cause = error;
  wrapped.tenantId = prepared?.tenantId ?? null;
  wrapped.commandId = prepared?.commandId ?? null;
  wrapped.attemptId = prepared?.attemptId ?? null;
  return wrapped;
}

function assertResultMatchesPrepared(result, prepared) {
  validateWiserrSubmissionResult(result);
  if (
    result.tenantId !== prepared.tenantId ||
    result.commandId !== prepared.commandId ||
    result.attemptId !== prepared.attemptId
  ) {
    throw new Error('WISERR_TRANSPORT_RESULT_IDENTITY_MISMATCH');
  }
}

/**
 * Single external-call boundary for the first reactivation loop.
 *
 * This function deliberately does not retry transport failures. Once
 * preparation succeeds, the durable attempt is SUBMITTING and external
 * acceptance may be unknowable. Any thrown/invalid transport outcome is
 * therefore reconciliation work, never permission to call transport again.
 */
export async function executePreparedWiserrReactivationSubmission({
  runtime,
  tenantId,
  campaignId,
  commandId,
  capacityProof,
  executionAuthorityDecision,
  transport,
  now = new Date()
}) {
  requiredString(tenantId, 'tenantId');
  requiredString(campaignId, 'campaignId');
  requiredString(commandId, 'commandId');
  if (typeof transport !== 'function') throw new Error('transport must be a function.');

  const prepared = await preparePersistedWiserrReactivationSubmission({
    runtime,
    tenantId,
    campaignId,
    commandId,
    capacityProof,
    executionAuthorityDecision,
    now
  });

  let result;
  try {
    result = await transport({
      schemaVersion: 1,
      tenantId,
      commandId,
      attemptId: prepared.attemptId,
      idempotencyKey: prepared.command.idempotencyKey,
      command: structuredClone(prepared.command)
    });
    assertResultMatchesPrepared(result, prepared);
  } catch (error) {
    throw reconciliationError(error, prepared);
  }

  const applied = await ingestWiserrReactivationSubmissionResultAndAdvanceCampaign({
    runtime,
    result,
    now
  });

  return Object.freeze({
    schemaVersion: 1,
    tenantId,
    commandId,
    attemptId: prepared.attemptId,
    resultId: result.resultId,
    outcome: result.outcome,
    attemptState: applied.attemptState,
    campaignId: applied.campaignId,
    campaignState: applied.campaignState,
    resultIdempotent: applied.resultIdempotent
  });
}
