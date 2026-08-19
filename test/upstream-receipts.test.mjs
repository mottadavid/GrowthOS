import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UPSTREAM_AUTHORITY_DECISIONS,
  evaluateUpstreamAuthority,
  validateUpstreamAuthorityReceipt
} from '../src/core/upstream-authority.mjs';
import {
  evaluateWiserrReactivationSmsExecutionAuthority,
  wiserrReactivationSmsAuthorityFingerprint,
  currentWiserrReactivationSmsObservedBasis
} from '../src/integrations/wiserr/reactivation-sms-authority.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snapshotReceiptPath = path.resolve(__dirname, '../contracts/upstream/wiserr-growth-snapshot.v1.json');
const smsReceiptPath = path.resolve(__dirname, '../contracts/upstream/wiserr-reactivation-sms.v1.json');

function load(pathname) {
  return JSON.parse(fs.readFileSync(pathname, 'utf8'));
}

test('checked-in Wiserr growth snapshot receipt is structurally valid', () => {
  const receipt = load(snapshotReceiptPath);
  assert.equal(validateUpstreamAuthorityReceipt(receipt), receipt);
});

test('candidate Wiserr growth snapshot receipt cannot unlock read capability', () => {
  const receipt = load(snapshotReceiptPath);
  const result = evaluateUpstreamAuthority({
    receipt,
    currentCommitSha: receipt.validatedCommitSha,
    requiredCapabilities: ['readGrowthSnapshot']
  });
  assert.equal(result.decision, UPSTREAM_AUTHORITY_DECISIONS.DENY);
  assert.ok(result.reasons.includes('CAPABILITY_NOT_CERTIFIED:readGrowthSnapshot'));
});

test('candidate snapshot receipt records producer existence without confusing it with mounted read authority', () => {
  const receipt = load(snapshotReceiptPath);
  assert.equal(receipt.status, 'CANDIDATE');
  assert.equal(receipt.capabilities.aggregateGrowthSnapshotProducer, true);
  assert.equal(receipt.capabilities.readGrowthSnapshot, false);
  assert.equal(receipt.capabilities.reactivationSmsExecution, false);
  assert.equal(receipt.capabilities.lunaCampaignContext, false);
});

test('checked-in Wiserr reactivation SMS receipt is structurally valid and fingerprinted to audited semantics', () => {
  const receipt = load(smsReceiptPath);
  assert.equal(validateUpstreamAuthorityReceipt(receipt), receipt);
  assert.equal(receipt.dependencyId, 'wiserr-reactivation-sms-v1');
  assert.equal(receipt.status, 'OBSERVED');
  assert.equal(receipt.authorityFingerprint, wiserrReactivationSmsAuthorityFingerprint(currentWiserrReactivationSmsObservedBasis()));
});

test('observed SMS receipt cannot unlock reactivation execution', () => {
  const receipt = load(smsReceiptPath);
  const result = evaluateWiserrReactivationSmsExecutionAuthority({
    receipt,
    currentCommitSha: receipt.validatedCommitSha,
    currentAuthorityFingerprint: receipt.authorityFingerprint
  });
  assert.equal(result.decision, UPSTREAM_AUTHORITY_DECISIONS.DENY);
  assert.ok(result.reasons.includes('CAPABILITY_NOT_CERTIFIED:reactivationSmsExecution'));
});

test('snapshot receipt and SMS receipt remain separate dependency identities', () => {
  const snapshot = load(snapshotReceiptPath);
  const sms = load(smsReceiptPath);
  assert.notEqual(snapshot.dependencyId, sms.dependencyId);
  assert.notEqual(snapshot.contractName, sms.contractName);
  assert.equal(snapshot.capabilities.readGrowthSnapshot, false);
  assert.equal(sms.capabilities.reactivationSmsExecution, false);
});
