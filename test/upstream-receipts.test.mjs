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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const receiptPath = path.resolve(__dirname, '../contracts/upstream/wiserr-growth-snapshot.v1.json');

function loadReceipt() {
  return JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
}

test('checked-in Wiserr growth snapshot receipt is structurally valid', () => {
  const receipt = loadReceipt();
  assert.equal(validateUpstreamAuthorityReceipt(receipt), receipt);
});

test('candidate Wiserr growth snapshot receipt cannot unlock read capability', () => {
  const receipt = loadReceipt();
  const result = evaluateUpstreamAuthority({
    receipt,
    currentCommitSha: receipt.validatedCommitSha,
    requiredCapabilities: ['readGrowthSnapshot']
  });
  assert.equal(result.decision, UPSTREAM_AUTHORITY_DECISIONS.DENY);
  assert.ok(result.reasons.includes('CAPABILITY_NOT_CERTIFIED:readGrowthSnapshot'));
});

test('candidate receipt records producer existence without confusing it with mounted read authority', () => {
  const receipt = loadReceipt();
  assert.equal(receipt.status, 'CANDIDATE');
  assert.equal(receipt.capabilities.aggregateGrowthSnapshotProducer, true);
  assert.equal(receipt.capabilities.readGrowthSnapshot, false);
  assert.equal(receipt.capabilities.reactivationSmsExecution, false);
  assert.equal(receipt.capabilities.lunaCampaignContext, false);
});
