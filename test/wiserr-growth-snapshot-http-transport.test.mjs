import test from 'node:test';
import assert from 'node:assert/strict';
import { createWiserrGrowthSnapshotHttpTransport } from '../src/integrations/wiserr/growth-snapshot-http-transport.mjs';

const SNAPSHOT = {
  schemaVersion: 1,
  snapshotId: 'snapshot-1',
  tenantId: 'tenant-a',
  generatedAt: '2026-08-19T14:20:00.000Z',
  completeness: 'PARTIAL',
  capacity: { status: 'UNKNOWN', demandThrottleRecommended: false, reason: 'external authority required' },
  reactivation: {
    cohortDefinitionId: 'non-won-inactive-leads',
    cohortDefinitionVersion: '1:90d',
    dormantCount: 10,
    eligibleByChannel: { sms: 5, email: 4, whatsapp: 3 },
    suppressedCount: 2,
    latestRelevantActivityAt: null
  },
  capabilities: {
    reactivationSms: false,
    reactivationEmail: false,
    reactivationWhatsapp: false,
    lunaReplyHandling: false,
    bookingOutcomes: false
  }
};

function jsonResponse(body = SNAPSHOT, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return structuredClone(body); } };
}

test('calls only the authenticated tenant snapshot route and never sends tenant override authority', async () => {
  let call;
  const tokenCalls = [];
  const transport = createWiserrGrowthSnapshotHttpTransport({
    baseUrl: 'https://wiserr.example/',
    getAccessToken: async (input) => { tokenCalls.push(input); return 'secret-token'; },
    fetchImpl: async (url, init) => { call = { url, init }; return jsonResponse(); }
  });

  const result = await transport({ tenantId: 'tenant-a', dormantDays: 90 });
  assert.deepEqual(result, SNAPSHOT);
  assert.deepEqual(tokenCalls, [{ tenantId: 'tenant-a' }]);
  assert.equal(call.url.pathname, '/api/tenant/growth/snapshot');
  assert.equal(call.url.searchParams.get('dormantDays'), '90');
  assert.equal(call.url.searchParams.has('tenantId'), false);
  assert.equal(call.url.searchParams.has('tenantSlug'), false);
  assert.equal(call.init.headers.authorization, 'Bearer secret-token');
  assert.equal(Object.keys(call.init.headers).some((key) => /tenant/i.test(key)), false);
  assert.equal(call.init.method, 'GET');
});

test('requires HTTPS except for explicit localhost development endpoints', () => {
  assert.throws(
    () => createWiserrGrowthSnapshotHttpTransport({ baseUrl: 'http://wiserr.example', getAccessToken: async () => 'token' }),
    /WISERR_GROWTH_SNAPSHOT_TRANSPORT_REQUIRES_HTTPS/
  );
  assert.doesNotThrow(() => createWiserrGrowthSnapshotHttpTransport({ baseUrl: 'http://127.0.0.1:3000', getAccessToken: async () => 'token' }));
  assert.doesNotThrow(() => createWiserrGrowthSnapshotHttpTransport({ baseUrl: 'http://localhost:3000', getAccessToken: async () => 'token' }));
});

test('requires explicit tenant, dormant window, credential provider, and bounded timeout', async () => {
  const transport = createWiserrGrowthSnapshotHttpTransport({
    baseUrl: 'https://wiserr.example',
    getAccessToken: async () => 'token',
    fetchImpl: async () => jsonResponse()
  });
  await assert.rejects(() => transport({ tenantId: '', dormantDays: 90 }), /tenantId must be a non-empty string/);
  await assert.rejects(() => transport({ tenantId: 'tenant-a', dormantDays: 0 }), /dormantDays must be a positive integer/);
  assert.throws(() => createWiserrGrowthSnapshotHttpTransport({ baseUrl: 'https://wiserr.example', getAccessToken: null }), /getAccessToken/);
  assert.throws(() => createWiserrGrowthSnapshotHttpTransport({ baseUrl: 'https://wiserr.example', getAccessToken: async () => 'token', timeoutMs: 99 }), /timeoutMs/);
});

test('never leaks access token or upstream response body in HTTP errors', async () => {
  const transport = createWiserrGrowthSnapshotHttpTransport({
    baseUrl: 'https://wiserr.example',
    getAccessToken: async () => 'TOP_SECRET_TOKEN',
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      async json() { return { error: 'postgres secret internals' }; }
    })
  });

  await assert.rejects(async () => {
    await transport({ tenantId: 'tenant-a', dormantDays: 90 });
  }, (error) => {
    assert.equal(error.message, 'WISERR_GROWTH_SNAPSHOT_HTTP_ERROR');
    assert.equal(error.metadata.status, 503);
    assert.equal(JSON.stringify(error).includes('TOP_SECRET_TOKEN'), false);
    assert.equal(JSON.stringify(error).includes('postgres secret internals'), false);
    return true;
  });
});

test('network/timeout failures are redacted and never retried inside the transport', async () => {
  let calls = 0;
  const transport = createWiserrGrowthSnapshotHttpTransport({
    baseUrl: 'https://wiserr.example',
    getAccessToken: async () => 'token',
    fetchImpl: async () => {
      calls += 1;
      const error = new Error('socket failed with private URL');
      error.name = 'TimeoutError';
      throw error;
    }
  });

  await assert.rejects(async () => {
    await transport({ tenantId: 'tenant-a', dormantDays: 90 });
  }, (error) => {
    assert.equal(error.message, 'WISERR_GROWTH_SNAPSHOT_TRANSPORT_FAILED');
    assert.deepEqual(error.metadata, { causeName: 'TimeoutError' });
    assert.equal(JSON.stringify(error).includes('private URL'), false);
    return true;
  });
  assert.equal(calls, 1);
});

test('malformed successful response JSON fails closed without response detail leakage', async () => {
  const transport = createWiserrGrowthSnapshotHttpTransport({
    baseUrl: 'https://wiserr.example',
    getAccessToken: async () => 'token',
    fetchImpl: async () => ({ ok: true, status: 200, async json() { throw new Error('private parse detail'); } })
  });
  await assert.rejects(() => transport({ tenantId: 'tenant-a', dormantDays: 90 }), /WISERR_GROWTH_SNAPSHOT_INVALID_JSON/);
});
