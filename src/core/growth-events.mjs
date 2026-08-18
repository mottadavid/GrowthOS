import crypto from 'node:crypto';

const EXECUTION_CERTAINTY = new Set(['CONFIRMED', 'DEFINITIVE_FAILURE', 'AMBIGUOUS', 'NOT_APPLICABLE']);
const ATTRIBUTION_CONFIDENCE = new Set(['DIRECT', 'HIGH', 'MEDIUM', 'LOW', 'UNATTRIBUTED', 'NOT_APPLICABLE']);

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function validDate(value, label) {
  requiredString(value, label);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label} must be a valid date-time.`);
  return ms;
}

export function validateGrowthEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('event must be an object.');
  if (event.schemaVersion !== 1) throw new Error('Unsupported growth event schemaVersion.');
  requiredString(event.eventId, 'event.eventId');
  requiredString(event.eventType, 'event.eventType');
  if (!/^growth\.[a-z0-9_.-]+$/.test(event.eventType)) throw new Error('Invalid event.eventType.');
  requiredString(event.tenantId, 'event.tenantId');
  validDate(event.occurredAt, 'event.occurredAt');
  validDate(event.recordedAt, 'event.recordedAt');
  requiredString(event.correlationId, 'event.correlationId');
  requiredString(event.sourceSystem, 'event.sourceSystem');
  if (!EXECUTION_CERTAINTY.has(event.executionCertainty)) throw new Error('Invalid event.executionCertainty.');
  if (!ATTRIBUTION_CONFIDENCE.has(event.attributionConfidence)) throw new Error('Invalid event.attributionConfidence.');
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new Error('event.payload must be an object.');
  return event;
}

export function createGrowthEvent({
  eventType,
  tenantId,
  occurredAt = new Date(),
  recordedAt = new Date(),
  correlationId,
  causationId = null,
  sourceSystem,
  actor = null,
  executionCertainty = 'NOT_APPLICABLE',
  attributionConfidence = 'NOT_APPLICABLE',
  payload = {}
}) {
  const event = {
    schemaVersion: 1,
    eventId: crypto.randomUUID(),
    eventType,
    tenantId,
    occurredAt: (occurredAt instanceof Date ? occurredAt : new Date(occurredAt)).toISOString(),
    recordedAt: (recordedAt instanceof Date ? recordedAt : new Date(recordedAt)).toISOString(),
    correlationId,
    causationId,
    sourceSystem,
    actor,
    executionCertainty,
    attributionConfidence,
    payload
  };
  return validateGrowthEvent(event);
}

export function appendGrowthEvent(ledger, event) {
  if (!Array.isArray(ledger)) throw new Error('ledger must be an array.');
  validateGrowthEvent(event);
  if (ledger.some(existing => existing.eventId === event.eventId)) throw new Error('DUPLICATE_GROWTH_EVENT_ID');
  ledger.push(event);
  return event;
}

export function buildGrowthTrace(events, { tenantId, correlationId }) {
  requiredString(tenantId, 'tenantId');
  requiredString(correlationId, 'correlationId');
  if (!Array.isArray(events)) throw new Error('events must be an array.');

  const trace = events
    .map(validateGrowthEvent)
    .filter(event => event.tenantId === tenantId && event.correlationId === correlationId)
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));

  return {
    tenantId,
    correlationId,
    eventCount: trace.length,
    firstOccurredAt: trace[0]?.occurredAt ?? null,
    lastOccurredAt: trace[trace.length - 1]?.occurredAt ?? null,
    events: trace
  };
}

export function validateOutcomeAttribution({
  confidence,
  canonicalOutcomeId,
  evidence = [],
  directCorrelationId = null
}) {
  if (!ATTRIBUTION_CONFIDENCE.has(confidence) || confidence === 'NOT_APPLICABLE') {
    throw new Error('Invalid outcome attribution confidence.');
  }
  requiredString(canonicalOutcomeId, 'canonicalOutcomeId');
  if (!Array.isArray(evidence)) throw new Error('evidence must be an array.');

  if (confidence === 'DIRECT') {
    requiredString(directCorrelationId, 'directCorrelationId');
    if (evidence.length === 0) throw new Error('DIRECT attribution requires explicit evidence.');
  }

  if (confidence === 'UNATTRIBUTED' && directCorrelationId) {
    throw new Error('UNATTRIBUTED outcome cannot carry a direct correlation ID.');
  }

  return {
    confidence,
    canonicalOutcomeId,
    directCorrelationId,
    evidence
  };
}

export function createOutcomeEvent({
  tenantId,
  correlationId,
  sourceSystem,
  canonicalOutcomeId,
  outcomeType,
  outcomeValue = null,
  attributionConfidence,
  attributionEvidence = [],
  directCorrelationId = null,
  occurredAt = new Date()
}) {
  requiredString(outcomeType, 'outcomeType');
  const attribution = validateOutcomeAttribution({
    confidence: attributionConfidence,
    canonicalOutcomeId,
    evidence: attributionEvidence,
    directCorrelationId
  });

  return createGrowthEvent({
    eventType: 'growth.business_outcome.observed',
    tenantId,
    occurredAt,
    correlationId,
    sourceSystem,
    executionCertainty: 'NOT_APPLICABLE',
    attributionConfidence,
    payload: {
      canonicalOutcomeId,
      outcomeType,
      outcomeValue,
      attribution
    }
  });
}

export function summarizeOutcomeTrace(trace) {
  if (!trace || typeof trace !== 'object' || !Array.isArray(trace.events)) throw new Error('trace is required.');
  const outcomes = trace.events.filter(event => event.eventType === 'growth.business_outcome.observed');
  const byConfidence = {};
  for (const event of outcomes) {
    byConfidence[event.attributionConfidence] = (byConfidence[event.attributionConfidence] || 0) + 1;
  }
  return {
    eventCount: trace.events.length,
    outcomeCount: outcomes.length,
    byConfidence,
    hasDirectOutcome: outcomes.some(event => event.attributionConfidence === 'DIRECT')
  };
}
