export function resolveGrowthOsDatabaseConfig(env = process.env) {
  const url = env.GROWTHOS_DATABASE_URL;
  if (typeof url !== 'string' || !url.trim()) {
    const error = new Error('GROWTHOS_DATABASE_URL is required for durable GrowthOS runtime storage.');
    error.code = 'GROWTHOS_DATABASE_URL_REQUIRED';
    throw error;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    const error = new Error('GROWTHOS_DATABASE_URL must be a valid PostgreSQL URL.');
    error.code = 'GROWTHOS_DATABASE_URL_INVALID';
    throw error;
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    const error = new Error('GROWTHOS_DATABASE_URL must use postgres:// or postgresql://.');
    error.code = 'GROWTHOS_DATABASE_URL_INVALID_PROTOCOL';
    throw error;
  }

  return {
    url,
    source: 'GROWTHOS_DATABASE_URL'
  };
}
