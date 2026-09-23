/** Pool PostgreSQL; consultas sempre parametrizadas e com schema explícito. */

import pg from 'pg';
import { cfg, log } from './config.js';

const RETRYABLE_PG_CODES = new Set([
  '57000', // client_idle_limit / admin_shutdown
  '57P01', // admin_shutdown
  '08006', // connection_failure
  '08003', // connection_does_not_exist
  '08000', // connection_exception
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  'XX000', // internal_error de pooler
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'
]);

function isRetryableError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  if (RETRYABLE_PG_CODES.has(code)) return true;
  return /terminat|connect|closed|ECONN|socket|reset|timeout|idle_limit|read data/i.test(msg);
}

export const pool = new pg.Pool({
  ...cfg.pg,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000
});

pool.on('error', (err) => {
  log(`[PG POOL] ${err.code || ''} ${err.message}`, 'ERROR');
});

pool.on('connect', (client) => {
  client.on('error', (err) => {
    log(`[PG CLIENT connect] ${err.code || ''} ${err.message}`, 'ERROR');
  });
});

export function attachClientErrorHandler(client, label = 'client') {
  if (!client || client._muneraErrorAttached) return;
  client._muneraErrorAttached = true;
  client.on('error', (err) => {
    log(`[PG ${label}] ${err.code || ''} ${err.message}`, 'ERROR');
  });
  return client;
}

export async function query(sql, params = [], maxRetries = 3) {
  let attempt = 0;
  let lastErr;
  while (attempt <= maxRetries) {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      lastErr = err;
      attempt++;
      if (attempt > maxRetries || !isRetryableError(err)) throw err;
      const delay = 250 * attempt;
      log(`query tentativa ${attempt}/${maxRetries} em ${delay}ms: ${err.code || ''} ${err.message}`, 'WARN');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function transaction(fn) {
  const client = await pool.connect();
  attachClientErrorHandler(client, 'transaction');
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      log(`[PG ROLLBACK] ${rollbackError.message}`, 'ERROR');
    }
    throw e;
  } finally {
    try { client.release(); } catch {}
  }
}

export async function audit(action, jobId, details = {}) {
  try {
    await query(
      'INSERT INTO munera.audit(action,job_id,details) VALUES($1,$2,$3::jsonb)',
      [action, jobId, JSON.stringify(details)]
    );
  } catch (e) {
    log(`[AUDIT FALHOU] ${action} job=${jobId}: ${e.message}`, 'ERROR');
  }
}

export function setupGlobalErrorHandlers() {
  process.on('uncaughtException', (err) => {
    log(`UNCAUGHT EXCEPTION: ${err.stack || err.message}`, 'ERROR');
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason?.stack || reason?.message || String(reason);
    log(`UNHANDLED REJECTION: ${msg}`, 'ERROR');
  });
}