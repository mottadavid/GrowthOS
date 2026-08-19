import test from 'node:test';
import assert from 'node:assert/strict';
import { AtomicPostgresRuntimeStore } from '../src/runtime/atomic-store.mjs';
import {
  createPgPoolTransactionRunner,
  createAtomicPostgresRuntimeStoreFromPool
} from '../src/runtime/postgres-transaction-adapter.mjs';

function fakePool({ failCommit = false, failRollback = false } = {}) {
  const calls = [];
  let releases = 0;
  const client = {
    async query(text, values) {
      calls.push({ text, values });
      if (text === 'COMMIT' && failCommit) throw new Error('commit failed');
      if (text === 'ROLLBACK' && failRollback) throw new Error('rollback failed');
      return { rows: [] };
    },
    release() {
      releases += 1;
    }
  };
  const pool = {
    async query(text, values) {
      calls.push({ text: `POOL:${text}`, values });
      return { rows: [] };
    },
    async connect() {
      calls.push({ text: 'CONNECT' });
      return client;
    }
  };
  return { pool, calls, get releases() { return releases; } };
}

test('transaction runner commits callback work on the same acquired client and releases it', async () => {
  const fake = fakePool();
  const withTransaction = createPgPoolTransactionRunner({ pool: fake.pool });
  const result = await withTransaction(async query => {
    await query('SELECT $1::int AS value', [7]);
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.deepEqual(fake.calls.map(call => call.text), ['CONNECT', 'BEGIN', 'SELECT $1::int AS value', 'COMMIT']);
  assert.equal(fake.releases, 1);
});

test('callback failure rolls back and releases without committing', async () => {
  const fake = fakePool();
  const withTransaction = createPgPoolTransactionRunner({ pool: fake.pool });
  await assert.rejects(
    () => withTransaction(async query => {
      await query('UPDATE something SET value = 1');
      throw new Error('mutation failed');
    }),
    /mutation failed/
  );
  assert.deepEqual(fake.calls.map(call => call.text), ['CONNECT', 'BEGIN', 'UPDATE something SET value = 1', 'ROLLBACK']);
  assert.equal(fake.releases, 1);
});

test('commit failure triggers rollback and releases the client', async () => {
  const fake = fakePool({ failCommit: true });
  const withTransaction = createPgPoolTransactionRunner({ pool: fake.pool });
  await assert.rejects(() => withTransaction(async () => 'value'), /commit failed/);
  assert.deepEqual(fake.calls.map(call => call.text), ['CONNECT', 'BEGIN', 'COMMIT', 'ROLLBACK']);
  assert.equal(fake.releases, 1);
});

test('rollback failure is surfaced distinctly while retaining the original failure as cause', async () => {
  const fake = fakePool({ failRollback: true });
  const withTransaction = createPgPoolTransactionRunner({ pool: fake.pool });
  let caught = null;
  try {
    await withTransaction(async () => { throw new Error('original failure'); });
  } catch (error) {
    caught = error;
  }
  assert.equal(caught?.code, 'RUNTIME_TRANSACTION_ROLLBACK_FAILED');
  assert.match(caught?.cause?.message || '', /original failure/);
  assert.match(caught?.rollbackCause?.message || '', /rollback failed/);
  assert.equal(fake.releases, 1);
});

test('invalid pool or transaction client fails closed', async () => {
  assert.throws(() => createPgPoolTransactionRunner({ pool: {} }), /pool.query/);

  const withMissingClient = createPgPoolTransactionRunner({
    pool: { query: async () => ({ rows: [] }), connect: async () => null }
  });
  await assert.rejects(() => withMissingClient(async () => null), /RUNTIME_TRANSACTION_CLIENT_UNAVAILABLE/);

  const withMissingRelease = createPgPoolTransactionRunner({
    pool: {
      query: async () => ({ rows: [] }),
      connect: async () => ({ query: async () => ({ rows: [] }) })
    }
  });
  await assert.rejects(() => withMissingRelease(async () => null), /transaction client.release/);
});

test('pool adapter returns the canonical AtomicPostgresRuntimeStore', () => {
  const fake = fakePool();
  const store = createAtomicPostgresRuntimeStoreFromPool({ pool: fake.pool });
  assert.equal(store instanceof AtomicPostgresRuntimeStore, true);
  assert.equal(typeof store.mutateRecordAndAppendEvent, 'function');
});
