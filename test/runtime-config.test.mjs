import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGrowthOsDatabaseConfig } from '../src/runtime/config.mjs';

test('requires dedicated GROWTHOS_DATABASE_URL and never falls back to DATABASE_URL', () => {
  assert.throws(
    () => resolveGrowthOsDatabaseConfig({ DATABASE_URL: 'postgres://wiserr.example/wiserr' }),
    error => error.code === 'GROWTHOS_DATABASE_URL_REQUIRED'
  );
});

test('accepts explicit PostgreSQL GrowthOS database URL', () => {
  const config = resolveGrowthOsDatabaseConfig({
    GROWTHOS_DATABASE_URL: 'postgresql://growth_user:secret@example.test:25060/growthos?sslmode=require',
    DATABASE_URL: 'postgresql://wiserr_user:secret@example.test:25060/wiserr'
  });
  assert.equal(config.source, 'GROWTHOS_DATABASE_URL');
  assert.match(config.url, /\/growthos\?/);
});

test('rejects malformed and non-Postgres URLs', () => {
  assert.throws(
    () => resolveGrowthOsDatabaseConfig({ GROWTHOS_DATABASE_URL: 'not a url' }),
    error => error.code === 'GROWTHOS_DATABASE_URL_INVALID'
  );
  assert.throws(
    () => resolveGrowthOsDatabaseConfig({ GROWTHOS_DATABASE_URL: 'redis://example.test/growthos' }),
    error => error.code === 'GROWTHOS_DATABASE_URL_INVALID_PROTOCOL'
  );
});
