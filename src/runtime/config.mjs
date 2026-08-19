export const GROWTHOS_EXECUTION_MODES = Object.freeze({
  READ_ONLY: 'READ_ONLY',
  ENABLED: 'ENABLED'
});

function runtimeError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

export function resolveGrowthOsExecutionConfig(env = process.env) {
  const raw = env?.GROWTHOS_EXECUTION_MODE;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return {
      mode: GROWTHOS_EXECUTION_MODES.READ_ONLY,
      executionAllowed: false,
      source: 'DEFAULT_FAIL_CLOSED'
    };
  }

  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'read_only' || normalized === 'readonly') {
    return {
      mode: GROWTHOS_EXECUTION_MODES.READ_ONLY,
      executionAllowed: false,
      source: 'GROWTHOS_EXECUTION_MODE'
    };
  }
  if (normalized === 'enabled') {
    return {
      mode: GROWTHOS_EXECUTION_MODES.ENABLED,
      executionAllowed: true,
      source: 'GROWTHOS_EXECUTION_MODE'
    };
  }

  throw runtimeError(
    'GROWTHOS_EXECUTION_MODE_INVALID',
    'GROWTHOS_EXECUTION_MODE must be read_only or enabled.'
  );
}

export function resolveGrowthOsDatabaseConfig(env = process.env) {
  const url = env.GROWTHOS_DATABASE_URL;
  if (typeof url !== 'string' || !url.trim()) {
    throw runtimeError(
      'GROWTHOS_DATABASE_URL_REQUIRED',
      'GROWTHOS_DATABASE_URL is required for durable GrowthOS runtime storage.'
    );
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw runtimeError(
      'GROWTHOS_DATABASE_URL_INVALID',
      'GROWTHOS_DATABASE_URL must be a valid PostgreSQL URL.'
    );
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw runtimeError(
      'GROWTHOS_DATABASE_URL_INVALID_PROTOCOL',
      'GROWTHOS_DATABASE_URL must use postgres:// or postgresql://.'
    );
  }

  return {
    url,
    source: 'GROWTHOS_DATABASE_URL'
  };
}
