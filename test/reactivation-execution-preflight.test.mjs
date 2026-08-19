import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityExecutionProofHash } from '../src/core/capacity-execution-proof.mjs';
import {
  evaluateReactivationExecutionPrerequisites,
  REACTIVATION_PREFLIGHT_DECISIONS
} from '../src/reactivation/execution-preflight.mjs';

const NOW = new Date('2026-08-18T20:00:00.000Z');

function snapshot(overrides = {}) {
  const base = {
    schemaVersion: 1,
    snapshotId: 'snapshot-current',
    tenantId: 'tenant-1',
    generatedAt: '2026-08-18T19:59:00.000Z',
    completeness: 'PARTIAL',
    capacity: { status: 'UNKNOWN', demandThrottleRecommended: false, reason: 'external_capacity_authority_required' },
    reactivation: {
      cohortDefinitionId: 'non-won-inactive-leads',
      cohortDefinitionVersion: '1:90d',
      dormantCount: 100,
      suppressedCount: 20,
      eligibleByChannel: { sms: 80, email: 60, whatsapp: 0 }
    },
    capabilities: {
      reactivationSms: false,
      reactivationEmail: false,
      reactivationWhatsapp: false,
      lunaReplyHandling: false,
      bookingOutcomes: false
    }
  };
  return {
    ...base,
    ...overrides,
    capacity: { ...base.capacity, ...(overrides.capacity || {}) },
    reactivation: {
      ...base.reactivation,
      ...(overrides.reactivation || {}),
      eligibleByChannel: { ...base.reactivation.eligibleByChannel, ...(overrides.reactivation?.eligibleByChannel || {}) }
    },
    capabilities: { ...base.capabilities, ...(overrides.capabilities || {}) }
  };
}

function capacityProof(overrides = {}) {
  const body = {
    schemaVersion: 1,
    tenantId: 'tenant-1',
    capacityBundleId: 'capacity-bundle-1',
    capacitySemanticHash: 'a'.repeat(64),
    evidenceId: 'capacity-evidence-1',
    authorityId: 'capacity-authority-1',
    authorityHash: 'b'.repeat(64),
    sourceSystem: 'wiserr',
    sourceAuthority: 'wiserr://capacity/owner-attestation',
    scopeKey: 'tenant:tenant-1:service:all',
    asOf: '2026-08-18T19:55:00.000Z',
    validUntil: '2026-08-18T21:00:00.000Z',
    derivedStatus: 'AVAILABLE',
    demandThrottleRecommended: false,
    authorityDecision: 'READY',
    ...overrides
  };
  return { ...body, proofHash: capacityExecutionProofHash(body) };
}

function smsReady(overrides = {}) {
  return {
    decision: 'READY',
    reasons: ['UPSTREAM_AUTHORITY_CERTIFIED'],
    metadata: {
      dependencyId: 'wiserr-reactivation-sms-v1',
      lockFingerprint: 'c'.repeat(64),
      ...overrides.metadata
    },
    ...overrides
  };
}

test('PARTIAL Wiserr snapshot with UNKNOWN embedded capacity can execute when external capacity and SMS authority are ready', () => {
  const result = evaluateReactivationExecutionPrerequisites({
    tenantId: 'tenant-1', currentSnapshot: snapshot(), channel: 'sms',
    capacityProof: capacityProof(), executionAuthorityDecision: smsReady(), now: NOW
  });
  assert.equal(result.decision, REACTIVATION_PREFLIGHT_DECISIONS.READY);
  assert.equal(result.currentEligibleRecipients, 80);
  assert.equal(result.capacityBundleId, 'capacity-bundle-1');
  assert.equal(result.executionAuthorityDependencyId, 'wiserr-reactivation-sms-v1');
});

test('optimistic snapshot capacity cannot bypass a missing external capacity proof', () => {
  const result = evaluateReactivationExecutionPrerequisites({
    tenantId: 'tenant-1',
    currentSnapshot: snapshot({ capacity: { status: 'AVAILABLE', demandThrottleRecommended: false } }),
    channel: 'sms', capacityProof: null, executionAuthorityDecision: smsReady(), now: NOW
  });
  assert.equal(result.decision, REACTIVATION_PREFLIGHT_DECISIONS.DENY);
  assert.ok(result.reasons.includes('CAPACITY_EXECUTION_PROOF_REQUIRED'));
});

test('eligibility evidence cannot bypass missing SMS execution authority', () => {
  const result = evaluateReactivationExecutionPrerequisites({
    tenantId: 'tenant-1', currentSnapshot: snapshot(), channel: 'sms', capacityProof: capacityProof(),
    executionAuthorityDecision: {
      decision: 'READY', reasons: ['UPSTREAM_AUTHORITY_CERTIFIED'],
      metadata: { dependencyId: 'wiserr-growth-snapshot-v1', lockFingerprint: 'd'.repeat(64) }
    },
    now: NOW
  });
  assert.equal(result.decision, REACTIVATION_PREFLIGHT_DECISIONS.DENY);
  assert.ok(result.reasons.includes('WISERR_REACTIVATION_SMS_EXECUTION_AUTHORITY_NOT_READY'));
});

test('SMS execution authority cannot bypass zero current eligibility', () => {
  const result = evaluateReactivationExecutionPrerequisites({
    tenantId: 'tenant-1',
    currentSnapshot: snapshot({ reactivation: { eligibleByChannel: { sms: 0 } } }),
    channel: 'sms', capacityProof: capacityProof(), executionAuthorityDecision: smsReady(), now: NOW
  });
  assert.equal(result.decision, REACTIVATION_PREFLIGHT_DECISIONS.NO_ACTION);
  assert.ok(result.reasons.includes('NO_CURRENTLY_ELIGIBLE_RECIPIENTS'));
});

test('expired, unavailable, cross-tenant, or mutated capacity proof fails closed', () => {
  const expired = capacityProof({ validUntil: '2026-08-18T19:59:00.000Z' });
  assert.equal(evaluateReactivationExecutionPrerequisites({ tenantId: 'tenant-1', currentSnapshot: snapshot(), channel: 'sms', capacityProof: expired, executionAuthorityDecision: smsReady(), now: NOW }).decision, REACTIVATION_PREFLIGHT_DECISIONS.NO_ACTION);

  const unavailable = capacityProof({ derivedStatus: 'FULL', demandThrottleRecommended: true });
  assert.equal(evaluateReactivationExecutionPrerequisites({ tenantId: 'tenant-1', currentSnapshot: snapshot(), channel: 'sms', capacityProof: unavailable, executionAuthorityDecision: smsReady(), now: NOW }).decision, REACTIVATION_PREFLIGHT_DECISIONS.NO_ACTION);

  const crossTenant = capacityProof({ tenantId: 'tenant-2' });
  assert.equal(evaluateReactivationExecutionPrerequisites({ tenantId: 'tenant-1', currentSnapshot: snapshot(), channel: 'sms', capacityProof: crossTenant, executionAuthorityDecision: smsReady(), now: NOW }).decision, REACTIVATION_PREFLIGHT_DECISIONS.DENY);

  const mutated = { ...capacityProof(), capacitySemanticHash: 'f'.repeat(64) };
  const changed = evaluateReactivationExecutionPrerequisites({ tenantId: 'tenant-1', currentSnapshot: snapshot(), channel: 'sms', capacityProof: mutated, executionAuthorityDecision: smsReady(), now: NOW });
  assert.equal(changed.decision, REACTIVATION_PREFLIGHT_DECISIONS.DENY);
  assert.ok(changed.reasons.includes('CAPACITY_EXECUTION_PROOF_HASH_MISMATCH'));
});
