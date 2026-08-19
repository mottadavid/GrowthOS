import { assertExecutionRuntime } from './bootstrap.mjs';
import { loadDurableWiserrReactivationCommand } from './wiserr-reactivation-command-repository.mjs';
import {
  loadDurableReactivationCampaign,
  completeDurableReactivationCampaign,
  stopDurableReactivationCampaign
} from './reactivation-campaign-repository.mjs';
import {
  loadDurableExperiment,
  markDurableExperimentObserving,
  evaluateAndCloseDurableExperiment
} from './experiment-repository.mjs';

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function assertIdentity({ command, campaign, experiment, tenantId }) {
  if (
    command.tenantId !== tenantId ||
    campaign.tenantId !== tenantId ||
    experiment.tenantId !== tenantId ||
    command.campaignId !== campaign.campaignId ||
    command.experimentId !== experiment.experimentId ||
    experiment.opportunityId !== command.opportunityId ||
    experiment.businessSnapshotId !== command.originalBusinessSnapshotId
  ) throw new Error('REACTIVATION_OBSERVATION_IDENTITY_MISMATCH');
}

function terminalExperiment(experiment) {
  return ['COMPLETED', 'INCONCLUSIVE', 'STOPPED'].includes(experiment.state);
}

function stopReason(experiment) {
  const reason = experiment.closeReasons?.join('|') || experiment.closeDecision || 'EXPERIMENT_STOPPED';
  return `EXPERIMENT_${experiment.closeDecision || 'STOPPED'}:${reason}`;
}

async function finishCampaignFromTerminalExperiment({ store, tenantId, campaignRecord, experimentRecord, now }) {
  const campaign = campaignRecord.payload;
  const experiment = experimentRecord.payload;
  if (experiment.state === 'STOPPED') {
    if (campaign.status === 'OBSERVING') {
      return {
        record: await stopDurableReactivationCampaign({ store, tenantId, campaignId: campaign.campaignId, reason: stopReason(experiment), now }),
        transitioned: true
      };
    }
    if (campaign.status !== 'STOPPED') throw new Error(`REACTIVATION_OBSERVATION_CAMPAIGN_STATE_CONFLICT:${campaign.status}`);
    if (campaign.stopReason !== stopReason(experiment)) throw new Error('REACTIVATION_OBSERVATION_CAMPAIGN_STOP_REASON_CONFLICT');
    return { record: campaignRecord, transitioned: false };
  }

  if (['COMPLETED', 'INCONCLUSIVE'].includes(experiment.state)) {
    if (campaign.status === 'OBSERVING') {
      return {
        record: await completeDurableReactivationCampaign({ store, tenantId, campaignId: campaign.campaignId, now }),
        transitioned: true
      };
    }
    if (campaign.status !== 'COMPLETED') throw new Error(`REACTIVATION_OBSERVATION_CAMPAIGN_STATE_CONFLICT:${campaign.status}`);
    return { record: campaignRecord, transitioned: false };
  }
  throw new Error(`REACTIVATION_OBSERVATION_TERMINAL_EXPERIMENT_UNSUPPORTED:${experiment.state}`);
}

export async function evaluateReactivationObservationAndCloseCampaign({ runtime, tenantId, commandId, observation = null, now = new Date() }) {
  requiredString(tenantId, 'tenantId');
  requiredString(commandId, 'commandId');
  if (runtime?.tenantId !== tenantId) throw new Error('REACTIVATION_OBSERVATION_RUNTIME_TENANT_MISMATCH');
  const store = assertExecutionRuntime(runtime);

  const commandRecord = await loadDurableWiserrReactivationCommand({ store, tenantId, commandId });
  if (!commandRecord) throw new Error('REACTIVATION_OBSERVATION_COMMAND_NOT_FOUND');
  const command = commandRecord.payload.command;

  let campaignRecord = await loadDurableReactivationCampaign({ store, tenantId, campaignId: command.campaignId });
  if (!campaignRecord) throw new Error('REACTIVATION_OBSERVATION_CAMPAIGN_NOT_FOUND');
  let experimentRecord = await loadDurableExperiment({ store, tenantId, experimentId: command.experimentId });
  if (!experimentRecord) throw new Error('REACTIVATION_OBSERVATION_EXPERIMENT_NOT_FOUND');
  assertIdentity({ command, campaign: campaignRecord.payload, experiment: experimentRecord.payload, tenantId });

  if (terminalExperiment(experimentRecord.payload)) {
    const finished = await finishCampaignFromTerminalExperiment({ store, tenantId, campaignRecord, experimentRecord, now });
    campaignRecord = finished.record;
    return {
      schemaVersion: 1, tenantId, commandId,
      campaignId: campaignRecord.recordId,
      experimentId: experimentRecord.recordId,
      experimentState: experimentRecord.payload.state,
      experimentDecision: experimentRecord.payload.closeDecision,
      campaignState: campaignRecord.payload.status,
      closed: true,
      idempotent: !finished.transitioned,
      campaignTransitioned: finished.transitioned,
      evidenceRefs: [...(experimentRecord.payload.closeEvidenceRefs || [])]
    };
  }

  if (campaignRecord.payload.status !== 'OBSERVING') throw new Error(`REACTIVATION_OBSERVATION_CAMPAIGN_NOT_OBSERVING:${campaignRecord.payload.status}`);
  if (!observation || typeof observation !== 'object') throw new Error('observation is required while experiment is open.');

  if (experimentRecord.payload.state === 'RUNNING') {
    experimentRecord = await markDurableExperimentObserving({ store, tenantId, experimentId: command.experimentId, now });
  } else if (experimentRecord.payload.state !== 'OBSERVING') {
    throw new Error(`REACTIVATION_OBSERVATION_EXPERIMENT_STATE_CONFLICT:${experimentRecord.payload.state}`);
  }

  const evaluated = await evaluateAndCloseDurableExperiment({ store, tenantId, experimentId: command.experimentId, observation, now });
  if (!evaluated.closed) {
    return {
      schemaVersion: 1, tenantId, commandId,
      campaignId: campaignRecord.recordId,
      experimentId: experimentRecord.recordId,
      experimentState: evaluated.record.payload.state,
      experimentDecision: evaluated.evaluation.decision,
      campaignState: campaignRecord.payload.status,
      closed: false,
      idempotent: false,
      campaignTransitioned: false,
      evidenceRefs: [...evaluated.evaluation.evidenceRefs]
    };
  }

  experimentRecord = evaluated.record;
  const finished = await finishCampaignFromTerminalExperiment({ store, tenantId, campaignRecord, experimentRecord, now });
  campaignRecord = finished.record;
  return {
    schemaVersion: 1, tenantId, commandId,
    campaignId: campaignRecord.recordId,
    experimentId: experimentRecord.recordId,
    experimentState: experimentRecord.payload.state,
    experimentDecision: experimentRecord.payload.closeDecision,
    campaignState: campaignRecord.payload.status,
    closed: true,
    idempotent: false,
    campaignTransitioned: finished.transitioned,
    evidenceRefs: [...experimentRecord.payload.closeEvidenceRefs]
  };
}
