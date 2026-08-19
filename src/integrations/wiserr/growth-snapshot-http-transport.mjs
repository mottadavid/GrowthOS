function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function normalizeBaseUrl(value) {
  const raw = requiredString(value, 'baseUrl');
  const url = new URL(raw);
  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalhost)) {
    throw new Error('WISERR_GROWTH_SNAPSHOT_TRANSPORT_REQUIRES_HTTPS');
  }
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return {
    origin: url.origin,
    basePath: normalizedPath === '/' ? '' : normalizedPath
  };
}

function validateAccessToken(value) {
  const token = requiredString(value, 'Wiserr access token');
  if (/\s/.test(token)) throw new Error('WISERR_ACCESS_TOKEN_INVALID');
  return token;
}

function transportError(code, metadata = {}) {
  const error = new Error(code);
  error.code = code;
  error.metadata = metadata;
  return error;
}

export function createWiserrGrowthSnapshotHttpTransport({
  baseUrl,
  getAccessToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (typeof getAccessToken !== 'function') throw new Error('getAccessToken must be a function.');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl must be a function.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new Error('timeoutMs must be an integer between 100 and 60000.');
  }

  return async function wiserrGrowthSnapshotTransport({ tenantId, dormantDays }) {
    requiredString(tenantId, 'tenantId');
    positiveInteger(dormantDays, 'dormantDays');

    const token = validateAccessToken(await getAccessToken({ tenantId }));
    const url = new URL(`${normalizedBaseUrl.origin}${normalizedBaseUrl.basePath}/api/tenant/growth/snapshot`);
    url.searchParams.set('dormantDays', String(dormantDays));

    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (cause) {
      throw transportError('WISERR_GROWTH_SNAPSHOT_TRANSPORT_FAILED', { causeName: cause?.name ?? 'Error' });
    }

    if (!response || typeof response.ok !== 'boolean' || typeof response.json !== 'function') {
      throw transportError('WISERR_GROWTH_SNAPSHOT_TRANSPORT_INVALID_RESPONSE');
    }

    if (!response.ok) {
      throw transportError('WISERR_GROWTH_SNAPSHOT_HTTP_ERROR', {
        status: Number.isInteger(response.status) ? response.status : null
      });
    }

    try {
      return await response.json();
    } catch {
      throw transportError('WISERR_GROWTH_SNAPSHOT_INVALID_JSON');
    }
  };
}
