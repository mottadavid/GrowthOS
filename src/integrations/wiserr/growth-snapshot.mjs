function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function validDate(value, label) {
  requiredString(value, label);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a valid date-time.`);
  return value;
}

const COMPLETENESS = new Set(['COMPLETE_FOR_PURPOSE', 'PARTIAL', 'STALE', 'UNAVAILABLE']);
const CAPACITY = new Set(['AVAILABLE', 'CONSTRAINED', 'FULL', 'UNKNOWN']);

export function validateWiserrGrowthSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('snapshot must be an object.');
  if (snapshot.schemaVersion !== 1) throw new Error('Unsupported snapshot schemaVersion.');
  requiredString(snapshot.snapshotId, 'snapshot.snapshotId');
  requiredString(snapshot.tenantId, 'snapshot.tenantId');
  validDate(snapshot.generatedAt, 'snapshot.generatedAt');
  if (!COMPLETENESS.has(snapshot.completeness)) throw new Error('Invalid snapshot.completeness.');

  if (!snapshot.capacity || typeof snapshot.capacity !== 'object') throw new Error('snapshot.capacity is required.');
  if (!CAPACITY.has(snapshot.capacity.status)) throw new Error('Invalid snapshot.capacity.status.');
  if (typeof snapshot.capacity.demandThrottleRecommended !== 'boolean') throw new Error('snapshot.capacity.demandThrottleRecommended must be boolean.');

  if (!snapshot.reactivation || typeof snapshot.reactivation !== 'object') throw new Error('snapshot.reactivation is required.');
  requiredString(snapshot.reactivation.cohortDefinitionId, 'snapshot.reactivation.cohortDefinitionId');
  requiredString(snapshot.reactivation.cohortDefinitionVersion, 'snapshot.reactivation.cohortDefinitionVersion');
  nonNegativeInteger(snapshot.reactivation.dormantCount, 'snapshot.reactivation.dormantCount');
  nonNegativeInteger(snapshot.reactivation.suppressedCount, 'snapshot.reactivation.suppressedCount');
  if (!snapshot.reactivation.eligibleByChannel || typeof snapshot.reactivation.eligibleByChannel !== 'object') {
    throw new Error('snapshot.reactivation.eligibleByChannel is required.');
  }
  for (const channel of ['sms', 'email', 'whatsapp']) {
    const value = snapshot.reactivation.eligibleByChannel[channel] ?? 0;
    nonNegativeInteger(value, `snapshot.reactivation.eligibleByChannel.${channel}`);
  }

  if (!snapshot.capabilities || typeof snapshot.capabilities !== 'object') throw new Error('snapshot.capabilities is required.');
  for (const key of ['reactivationSms', 'reactivationEmail', 'reactivationWhatsapp', 'lunaReplyHandling', 'bookingOutcomes']) {
    if (typeof snapshot.capabilities[key] !== 'boolean') throw new Error(`snapshot.capabilities.${key} must be boolean.`);
  }

  return snapshot;
}

export function toGrowthBusinessState(snapshot) {
  validateWiserrGrowthSnapshot(snapshot);
  return {
    tenantId: snapshot.tenantId,
    snapshotId: snapshot.snapshotId,
    generatedAt: snapshot.generatedAt,
    completeness: snapshot.completeness,
    capacity: {
      status: snapshot.capacity.status,
      demandThrottleRecommended: snapshot.capacity.demandThrottleRecommended,
      reason: snapshot.capacity.reason ?? null
    },
    cohorts: {
      dormantLeads: snapshot.reactivation.dormantCount
    }
  };
}

const CHANNEL_CAPABILITY = Object.freeze({
  sms: 'reactivationSms',
  email: 'reactivationEmail',
  whatsapp: 'reactivationWhatsapp'
});

export function channelEligibility(snapshot, channel) {
  validateWiserrGrowthSnapshot(snapshot);
  const capability = CHANNEL_CAPABILITY[channel];
  if (!capability) throw new Error(`Unsupported reactivation channel: ${channel}`);
  return {
    channel,
    capability,
    eligibleRecipients: snapshot.reactivation.eligibleByChannel[channel] ?? 0
  };
}

export function channelReadiness(snapshot, channel) {
  const eligibility = channelEligibility(snapshot, channel);
  const capabilityEnabled = snapshot.capabilities[eligibility.capability] === true;
  return {
    ...eligibility,
    capabilityEnabled,
    ready: capabilityEnabled && eligibility.eligibleRecipients > 0
  };
}

export function chooseReactivationChannel(snapshot, preferred = ['sms', 'email', 'whatsapp']) {
  validateWiserrGrowthSnapshot(snapshot);
  if (!Array.isArray(preferred) || preferred.length === 0) throw new Error('preferred must contain at least one channel.');
  const evaluated = preferred.map(channel => channelReadiness(snapshot, channel));
  return {
    selected: evaluated.find(item => item.ready) || null,
    evaluated
  };
}
