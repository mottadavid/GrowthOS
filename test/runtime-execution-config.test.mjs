import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROWTHOS_EXECUTION_MODES,
  resolveGrowthOsExecutionConfig
} from '../src/runtime/config.mjs';

test('unset execution mode defaults fail-closed to READ_ONLY', () => {
  const config = resolveGrowthOsExecutionConfig({});
  assert.deepEqual(config, {
    mode: GROWTHOS_EXECUTION_MODES.READ_ONLY,
    executionAllowed: false,
    source: 'DEFAULT_FAIL_CLOSED'
  });
});

test('read_only explicitly disables execution', () => {
  const config = resolveGrowthOsExecutionConfig({ GROWTHOS_EXECUTION_MODE: 'read_only' });
  assert.equal(config.mode, GROWTHOS_EXECUTION_MODES.READ_ONLY);
  assert.equal(config.executionAllowed, false);
  assert.equal(config.source, 'GROWTHOS_EXECUTION_MODE');
});

test('enabled is the only configuration that permits runtime execution', () => {
  const config = resolveGrowthOsExecutionConfig({ GROWTHOS_EXECUTION_MODE: 'enabled' });
  assert.equal(config.mode, GROWTHOS_EXECUTION_MODES.ENABLED);
  assert.equal(config.executionAllowed, true);
});

test('execution mode parsing is whitespace/case tolerant but not truthy-coercible', () => {
  assert.equal(
    resolveGrowthOsExecutionConfig({ GROWTHOS_EXECUTION_MODE: '  ENABLED  ' }).executionAllowed,
    true
  );
  for (const value of ['true', '1', 'yes', 'on', 'execute', 'production']) {
    assert.throws(
      () => resolveGrowthOsExecutionConfig({ GROWTHOS_EXECUTION_MODE: value }),
      error => error?.code === 'GROWTHOS_EXECUTION_MODE_INVALID'
    );
  }
});
