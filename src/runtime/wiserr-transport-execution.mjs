import { assertExecutionRuntime } from './bootstrap.mjs';
import { executePreparedWiserrReactivationSubmission } from './wiserr-transport-orchestrator.mjs';
import { persistDurableWiserrTransportFault } from './wiserr-transport-fault-repository.mjs';
import { markDurableExecutionReconciliationRequired } from './execution-attempt-repository.mjs';
import { loadDurableWiserrReactivationCommand } from './wiserr-reactivation-command-repository.mjs';
import { loadDurableReactivationCampaign, markDurableReactivationCampaignReconciliationRequired } from './reactivation-campaign-repository.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

/**
 * Production-facing wrapper around the single-call transport orchestrator.
 *
 * If the transport boundary becomes ambiguous after SUBMITTING, this wrapper
 * records privacy-safe local fault evidence and moves the attempt/campaign to
 * reconciliation-required state. It never retries transport.
 */
export async function executeWiserrReactivationWithDurableFaultEvidence(args) {
  const tenantId = requiredString(args?.tenantId, 'tenantId');
  const commandId = requiredString(args?.commandId, 'commandId');
  const runtime = args?.runtime;
  const store = assertExecutionRuntime(runtime);

  try {
    return await executePreparedWiserrReactivationSubmission(args);
  } catch (error) {
    if (error?.code !== 'WISERR_TRANSPORT_OUTCOME_REQUIRES_RECONCILIATION') throw error;

    const commandRecord = await loadDurableWiserrReactivationCommand({ store, tenantId, commandId });
    if (!commandRecord) throw error;
    const command = commandRecord.payload.command;

    const fault = await persistDurableWiserrTransportFault({
      store,
      tenantId,
      commandId,
      attemptId: command.attemptId,
      error: error.cause ?? error,
      now: args?.now ?? new Date()
    });

    const reason = `WISERR_TRANSPORT_AMBIGUOUS:${fault.evidenceRef}`;
    try {
      await markDurableExecutionReconciliationRequired({ store, tenantId, attemptId: command.attemptId, error: new Error(reason), now: args?.now ?? new Date() });
    } catch (transitionError) {
      if (!String(transitionError?.message || '').includes('not allowed from RECONCILIATION_REQUIRED')) throw transitionError;
    }

    const campaign = await loadDurableReactivationCampaign({ store, tenantId, campaignId: command.campaignId });
    if (campaign?.payload?.status === 'EXECUTING') {
      await markDurableReactivationCampaignReconciliationRequired({ store, tenantId, campaignId: command.campaignId, reason, now: args?.now ?? new Date() });
    } else if (campaign?.payload?.status !== 'RECONCILIATION_REQUIRED') {
      throw new Error(`WISERR_TRANSPORT_RECONCILIATION_CAMPAIGN_STATE_CONFLICT:${campaign?.payload?.status ?? 'MISSING'}`);
    }

    const wrapped = new Error('WISERR_TRANSPORT_OUTCOME_REQUIRES_RECONCILIATION');
    wrapped.code = 'WISERR_TRANSPORT_OUTCOME_REQUIRES_RECONCILIATION';
    wrapped.requiresReconciliation = true;
    wrapped.evidenceRef = fault.evidenceRef;
    wrapped.faultId = fault.record.recordId;
    wrapped.cause = error.cause ?? error;
    throw wrapped;
  }
}
