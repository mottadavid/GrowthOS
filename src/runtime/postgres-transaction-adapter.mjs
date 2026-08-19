import { AtomicPostgresRuntimeStore } from './atomic-store.mjs';

function requiredFunction(value, label) {
  if (typeof value !== 'function') throw new Error(`${label} must be a function.`);
  return value;
}

function runtimeError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createPgPoolTransactionRunner({ pool }) {
  if (!pool || typeof pool !== 'object') throw new Error('pool is required.');
  requiredFunction(pool.query, 'pool.query');
  requiredFunction(pool.connect, 'pool.connect');

  return async function withTransaction(callback) {
    requiredFunction(callback, 'transaction callback');
    const client = await pool.connect();
    if (!client || typeof client !== 'object') throw runtimeError('RUNTIME_TRANSACTION_CLIENT_UNAVAILABLE');
    requiredFunction(client.query, 'transaction client.query');
    requiredFunction(client.release, 'transaction client.release');

    let began = false;
    let committed = false;
    try {
      await client.query('BEGIN');
      began = true;
      const transactionQuery = (text, values) => client.query(text, values);
      const result = await callback(transactionQuery);
      await client.query('COMMIT');
      committed = true;
      return result;
    } catch (error) {
      if (began && !committed) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          const wrapped = runtimeError('RUNTIME_TRANSACTION_ROLLBACK_FAILED');
          wrapped.cause = error;
          wrapped.rollbackCause = rollbackError;
          throw wrapped;
        }
      }
      throw error;
    } finally {
      client.release();
    }
  };
}

export function createAtomicPostgresRuntimeStoreFromPool({ pool }) {
  if (!pool || typeof pool !== 'object') throw new Error('pool is required.');
  const query = requiredFunction(pool.query, 'pool.query').bind(pool);
  const withTransaction = createPgPoolTransactionRunner({ pool });
  return new AtomicPostgresRuntimeStore({ query, withTransaction });
}
