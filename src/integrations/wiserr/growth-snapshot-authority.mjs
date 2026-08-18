import { sha256Canonical } from '../../core/canonical.mjs';

const REQUIRED_BOOLEAN_CAPABILITIES = Object.freeze([
  'aggregateGrowthSnapshotProducer',
  'readGrowthSnapshot',
  'reactivationSmsExecution',
  'reactivationEmailExecution',
  'lunaCampaignContext',
  'canonicalBookingOutcomeEvents',
  'canonicalWonRevenueOutcomeEvents'
]);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function uniqueStrings(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must contain at least one value.`);
  const normalized = value.map((item) => requiredString(item, `${label} item`));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates.`);
  return [...normalized].sort();
}

export function validateWiserrGrowthSnapshotAuthorityBasis(basis) {
  if (!basis || typeof basis !== 'object' || Array.isArray(basis)) throw new Error('basis must be an object.');
  if (basis.schemaVersion !== 1) throw new Error('Unsupported basis.schemaVersion.');
  requiredString(basis.contractName, 'basis.contractName');
  requiredString(basis.contractVersion, 'basis.contractVersion');
  if (basis.contractName !== 'wiserr-growth-snapshot') throw new Error('Unexpected basis.contractName.');

  uniqueStrings(basis.guardedPaths, 'basis.guardedPaths');

  if (!basis.cohort || typeof basis.cohort !== 'object') throw new Error('basis.cohort is required.');
  if (basis.cohort.dormancyWindow !== 'EXPLICIT_CALLER_SUPPLIED_DAYS') throw new Error('Invalid cohort dormancyWindow.');
  if (basis.cohort.stageExclusion !== 'won') throw new Error('Invalid cohort stageExclusion.');
  if (basis.cohort.activityAuthority !== 'leads.updated_at') throw new Error('Invalid cohort activityAuthority.');

  if (!basis.privacy || typeof basis.privacy !== 'object') throw new Error('basis.privacy is required.');
  for (const key of ['aggregateOnly', 'noRecipientPII', 'finalEligibilityInsideWiserr']) {
    if (basis.privacy[key] !== true) throw new Error(`basis.privacy.${key} must be true.`);
  }

  if (!basis.planningState || typeof basis.planningState !== 'object') throw new Error('basis.planningState is required.');
  if (basis.planningState.completeness !== 'PARTIAL') throw new Error('planning completeness must remain PARTIAL.');
  if (basis.planningState.capacityStatus !== 'UNKNOWN') throw new Error('planning capacity must remain UNKNOWN.');

  if (!basis.readSurface || typeof basis.readSurface !== 'object') throw new Error('basis.readSurface is required.');
  if (typeof basis.readSurface.mounted !== 'boolean') throw new Error('basis.readSurface.mounted must be boolean.');
  if (basis.readSurface.mounted) {
    requiredString(basis.readSurface.authAuthority, 'basis.readSurface.authAuthority');
    requiredString(basis.readSurface.routeOrService, 'basis.readSurface.routeOrService');
  } else if (basis.readSurface.authAuthority !== null || basis.readSurface.routeOrService !== null) {
    throw new Error('Unmounted readSurface must not claim auth or route authority.');
  }

  if (!basis.capabilities || typeof basis.capabilities !== 'object' || Array.isArray(basis.capabilities)) throw new Error('basis.capabilities is required.');
  for (const key of REQUIRED_BOOLEAN_CAPABILITIES) {
    if (typeof basis.capabilities[key] !== 'boolean') throw new Error(`basis.capabilities.${key} must be boolean.`);
  }
  if (basis.capabilities.readGrowthSnapshot !== basis.readSurface.mounted) {
    throw new Error('readGrowthSnapshot capability must match readSurface.mounted.');
  }

  return basis;
}

export function wiserrGrowthSnapshotAuthorityFingerprint(basis) {
  validateWiserrGrowthSnapshotAuthorityBasis(basis);
  return sha256Canonical({
    schemaVersion: basis.schemaVersion,
    contractName: basis.contractName,
    contractVersion: basis.contractVersion,
    guardedPaths: [...basis.guardedPaths].sort(),
    cohort: basis.cohort,
    privacy: basis.privacy,
    planningState: basis.planningState,
    readSurface: basis.readSurface,
    capabilities: basis.capabilities
  });
}

export function currentWiserrGrowthSnapshotProducerBasis() {
  return {
    schemaVersion: 1,
    contractName: 'wiserr-growth-snapshot',
    contractVersion: '1',
    guardedPaths: [
      'server/growth/growthSnapshotService.ts',
      'tests/growth/growthSnapshotService.test.ts',
      'docs/growth/GROWTHOS_READ_CONTRACT.md'
    ],
    cohort: {
      dormancyWindow: 'EXPLICIT_CALLER_SUPPLIED_DAYS',
      stageExclusion: 'won',
      activityAuthority: 'leads.updated_at',
      channelEligibility: 'contact_field_present_and_not_global_or_channel_opted_out',
      finalRecipientEligibility: 'WISERR_EXECUTION_TIME'
    },
    privacy: {
      aggregateOnly: true,
      noRecipientPII: true,
      finalEligibilityInsideWiserr: true
    },
    planningState: {
      completeness: 'PARTIAL',
      capacityStatus: 'UNKNOWN',
      demandThrottleAuthority: 'GROWTHOS_DOWNSTREAM_FAIL_CLOSED'
    },
    readSurface: {
      mounted: false,
      authAuthority: null,
      routeOrService: null
    },
    capabilities: {
      aggregateGrowthSnapshotProducer: true,
      readGrowthSnapshot: false,
      reactivationSmsExecution: false,
      reactivationEmailExecution: false,
      lunaCampaignContext: false,
      canonicalBookingOutcomeEvents: false,
      canonicalWonRevenueOutcomeEvents: false
    }
  };
}
