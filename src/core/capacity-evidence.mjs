export const CAPACITY_STATUSES = Object.freeze(['AVAILABLE', 'CONSTRAINED', 'FULL', 'UNKNOWN']);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function parseDate(value, label, nullable = false) {
  if (value === null && nullable) return null;
  requiredString(value, label);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label} must be a valid date-time.`);
  return ms;
}

export function validateCapacityEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('evidence must be an object.');
  if (evidence.schemaVersion !== 1) throw new Error('Unsupported evidence schemaVersion.');
  requiredString(evidence.evidenceId, 'evidence.evidenceId');
  requiredString(evidence.tenantId, 'evidence.tenantId');
  requiredString(evidence.scopeKey, 'evidence.scopeKey');
  requiredString(evidence.sourceSystem, 'evidence.sourceSystem');
  requiredString(evidence.sourceAuthority, 'evidence.sourceAuthority');
  parseDate(evidence.asOf, 'evidence.asOf');
  if (evidence.validUntil !== undefined) parseDate(evidence.validUntil, 'evidence.validUntil', true);
  if (!['COMPLETE_FOR_PURPOSE', 'PARTIAL', 'STALE', 'UNAVAILABLE'].includes(evidence.completeness)) {
    throw new Error('Invalid evidence.completeness.');
  }
  if (!Array.isArray(evidence.signals)) throw new Error('evidence.signals must be an array.');
  const seen = new Set();
  for (const signal of evidence.signals) {
    if (!signal || typeof signal !== 'object' || Array.isArray(signal)) throw new Error('capacity signal must be an object.');
    requiredString(signal.signalId, 'signal.signalId');
    if (seen.has(signal.signalId)) throw new Error(`Duplicate capacity signalId: ${signal.signalId}`);
    seen.add(signal.signalId);
    if (!['AVAILABLE', 'CONSTRAINED', 'FULL', 'INFORMATIONAL'].includes(signal.verdict)) throw new Error('Invalid signal.verdict.');
    if (typeof signal.authoritative !== 'boolean') throw new Error('signal.authoritative must be boolean.');
    requiredString(signal.sourceRef, 'signal.sourceRef');
  }
  return evidence;
}

export function deriveCapacityState(evidence, { now = new Date() } = {}) {
  validateCapacityEvidence(evidence);
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error('now must be a valid date/time.');

  const reasons = [];
  if (['STALE', 'UNAVAILABLE'].includes(evidence.completeness)) {
    return {
      status: 'UNKNOWN',
      demandThrottleRecommended: true,
      reasons: ['CAPACITY_EVIDENCE_NOT_CURRENT'],
      evidenceId: evidence.evidenceId,
      scopeKey: evidence.scopeKey
    };
  }
  if (evidence.validUntil && nowMs > Date.parse(evidence.validUntil)) {
    return {
      status: 'UNKNOWN',
      demandThrottleRecommended: true,
      reasons: ['CAPACITY_EVIDENCE_EXPIRED'],
      evidenceId: evidence.evidenceId,
      scopeKey: evidence.scopeKey
    };
  }

  const authoritative = evidence.signals.filter(signal => signal.authoritative === true);
  const hasFull = authoritative.some(signal => signal.verdict === 'FULL');
  const hasConstrained = authoritative.some(signal => signal.verdict === 'CONSTRAINED');
  const hasAvailable = authoritative.some(signal => signal.verdict === 'AVAILABLE');

  if (hasFull) {
    reasons.push('AUTHORITATIVE_FULL_SIGNAL');
    if (hasConstrained || hasAvailable) reasons.push('CONFLICTING_CAPACITY_SIGNALS_FULL_WINS');
    return {
      status: 'FULL',
      demandThrottleRecommended: true,
      reasons,
      evidenceId: evidence.evidenceId,
      scopeKey: evidence.scopeKey
    };
  }

  if (hasConstrained) {
    reasons.push('AUTHORITATIVE_CONSTRAINED_SIGNAL');
    if (hasAvailable) reasons.push('CONFLICTING_CAPACITY_SIGNALS_CONSTRAINT_WINS');
    return {
      status: 'CONSTRAINED',
      demandThrottleRecommended: true,
      reasons,
      evidenceId: evidence.evidenceId,
      scopeKey: evidence.scopeKey
    };
  }

  if (evidence.completeness !== 'COMPLETE_FOR_PURPOSE') {
    return {
      status: 'UNKNOWN',
      demandThrottleRecommended: true,
      reasons: ['CAPACITY_EVIDENCE_PARTIAL'],
      evidenceId: evidence.evidenceId,
      scopeKey: evidence.scopeKey
    };
  }

  if (hasAvailable) {
    return {
      status: 'AVAILABLE',
      demandThrottleRecommended: false,
      reasons: ['AUTHORITATIVE_AVAILABLE_SIGNAL'],
      evidenceId: evidence.evidenceId,
      scopeKey: evidence.scopeKey
    };
  }

  return {
    status: 'UNKNOWN',
    demandThrottleRecommended: true,
    reasons: ['NO_AUTHORITATIVE_CAPACITY_SIGNAL'],
    evidenceId: evidence.evidenceId,
    scopeKey: evidence.scopeKey
  };
}

export function capacityForBusinessState(evidence, options = {}) {
  const derived = deriveCapacityState(evidence, options);
  return {
    status: derived.status,
    signals: [
      {
        kind: 'CAPACITY_EVIDENCE',
        source: evidence.sourceSystem,
        authority: evidence.sourceAuthority,
        reference: evidence.evidenceId,
        scopeKey: evidence.scopeKey,
        reasons: derived.reasons
      }
    ],
    demandThrottleRecommended: derived.demandThrottleRecommended
  };
}
