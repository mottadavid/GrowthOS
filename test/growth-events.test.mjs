import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendGrowthEvent,
  buildGrowthTrace,
  createGrowthEvent,
  createOutcomeEvent,
  summarizeOutcomeTrace,
  validateOutcomeAttribution
} from '../src/core/growth-events.mjs';

const TENANT = 'tenant-1';
const CORR = 'growth-run-1';

test('creates and appends tenant-scoped growth events', () => {
  const ledger = [];
  const event = createGrowthEvent({
    eventType: 'growth.opportunity.detected',
    tenantId: TENANT,
    correlationId: CORR,
    sourceSystem: 'growthos',
    payload: { opportunityId: 'opp-1' },
    occurredAt: '2026-08-18T19:00:00Z',
    recordedAt: '2026-08-18T19:00:01Z'
  });
  appendGrowthEvent(ledger, event);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].tenantId, TENANT);
});

test('rejects duplicate event IDs', () => {
  const ledger = [];
  const event = createGrowthEvent({
    eventType: 'growth.action.approved',
    tenantId: TENANT,
    correlationId: CORR,
    sourceSystem: 'growthos',
    payload: { actionId: 'action-1' }
  });
  appendGrowthEvent(ledger, event);
  assert.throws(() => appendGrowthEvent(ledger, event), /DUPLICATE_GROWTH_EVENT_ID/);
});

test('builds trace without mixing tenants or correlations', () => {
  const events = [
    createGrowthEvent({ eventType: 'growth.opportunity.detected', tenantId: TENANT, correlationId: CORR, sourceSystem: 'growthos', payload: {}, occurredAt: '2026-08-18T19:00:00Z' }),
    createGrowthEvent({ eventType: 'growth.execution.completed', tenantId: TENANT, correlationId: CORR, sourceSystem: 'wiserr', payload: {}, occurredAt: '2026-08-18T19:02:00Z', executionCertainty: 'CONFIRMED' }),
    createGrowthEvent({ eventType: 'growth.execution.completed', tenantId: 'tenant-2', correlationId: CORR, sourceSystem: 'wiserr', payload: {}, occurredAt: '2026-08-18T19:01:00Z', executionCertainty: 'CONFIRMED' }),
    createGrowthEvent({ eventType: 'growth.execution.completed', tenantId: TENANT, correlationId: 'other-run', sourceSystem: 'wiserr', payload: {}, occurredAt: '2026-08-18T19:01:00Z', executionCertainty: 'CONFIRMED' })
  ];
  const trace = buildGrowthTrace(events, { tenantId: TENANT, correlationId: CORR });
  assert.equal(trace.eventCount, 2);
  assert.equal(trace.events[0].eventType, 'growth.opportunity.detected');
  assert.equal(trace.events[1].eventType, 'growth.execution.completed');
});

test('DIRECT attribution requires canonical outcome, direct correlation, and evidence', () => {
  assert.throws(() => validateOutcomeAttribution({
    confidence: 'DIRECT',
    canonicalOutcomeId: 'booking-1',
    evidence: [],
    directCorrelationId: CORR
  }), /explicit evidence/);

  const result = validateOutcomeAttribution({
    confidence: 'DIRECT',
    canonicalOutcomeId: 'booking-1',
    evidence: ['Wiserr booking event retained campaign correlation ID'],
    directCorrelationId: CORR
  });
  assert.equal(result.confidence, 'DIRECT');
});

test('UNATTRIBUTED outcome cannot smuggle a direct correlation ID', () => {
  assert.throws(() => validateOutcomeAttribution({
    confidence: 'UNATTRIBUTED',
    canonicalOutcomeId: 'sale-1',
    evidence: [],
    directCorrelationId: CORR
  }), /cannot carry a direct correlation ID/);
});

test('creates outcome events without pretending execution certainty equals attribution certainty', () => {
  const outcome = createOutcomeEvent({
    tenantId: TENANT,
    correlationId: CORR,
    sourceSystem: 'wiserr',
    canonicalOutcomeId: 'booking-1',
    outcomeType: 'BOOKING_CREATED',
    attributionConfidence: 'MEDIUM',
    attributionEvidence: ['Same contact booked within observation window after reactivation reply'],
    occurredAt: '2026-08-18T20:00:00Z'
  });
  assert.equal(outcome.executionCertainty, 'NOT_APPLICABLE');
  assert.equal(outcome.attributionConfidence, 'MEDIUM');
});

test('summarizes outcomes by confidence without converting correlation to causality', () => {
  const events = [
    createGrowthEvent({ eventType: 'growth.opportunity.detected', tenantId: TENANT, correlationId: CORR, sourceSystem: 'growthos', payload: {} }),
    createOutcomeEvent({ tenantId: TENANT, correlationId: CORR, sourceSystem: 'wiserr', canonicalOutcomeId: 'booking-1', outcomeType: 'BOOKING_CREATED', attributionConfidence: 'DIRECT', attributionEvidence: ['booking event has campaign correlation'], directCorrelationId: CORR }),
    createOutcomeEvent({ tenantId: TENANT, correlationId: CORR, sourceSystem: 'wiserr', canonicalOutcomeId: 'sale-1', outcomeType: 'SALE_WON', attributionConfidence: 'LOW', attributionEvidence: ['sale occurred later; competing touchpoints unknown'] })
  ];
  const trace = buildGrowthTrace(events, { tenantId: TENANT, correlationId: CORR });
  const summary = summarizeOutcomeTrace(trace);
  assert.equal(summary.outcomeCount, 2);
  assert.equal(summary.byConfidence.DIRECT, 1);
  assert.equal(summary.byConfidence.LOW, 1);
  assert.equal(summary.hasDirectOutcome, true);
});
