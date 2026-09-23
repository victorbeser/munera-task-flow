// Daemon: API HTTP local + loop de agendamento + controle de encerramento.
// PostgreSQL advisory lock impede dois schedulers no MESMO banco.
import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
import { log, parseTimes, resolveScript, safeName } from './util.js';
import { pool, acquireDaemonLock, releaseDaemonLock, checkDatabase,
  listJobs, getJob, upsertJob, updateJob, deleteJob, claimDue,
  recentExecutions, markInterrupted, attachClientErrorHandler, setupGlobalErrorHandlers } from './db.js';
import { execute, runningJobs, runningCount, stopChildren } from './runner.js';

setupGlobalErrorHandlers();

let server, lockClient, ticker, stopping = false, ticking = false, reconnectTimer = null;
const startedAt = new Date().toISOString();

function clearDaemonReconnect() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

function bindLockClientHandlers(client) {
  if (!client) return;
  attachClientErrorHandler(client, 'daemon-lock');
  client.on('error', (err) => {
    log(`[DAEMON LOCK] conexão perdida: ${err.code || ''} ${err.message}`, 'ERROR');
    if (stopping) return;
    try { client.release(true); } catch {}
    if (lockClient === client) lockClient = null;
    clearDaemonReconnect();
    reconnectTimer = setTimeout(() => tryReconnectLock().catch(e => log(`Reconexão daemon lock falhou: ${e.message}`, 'ERROR')), 3000);
  });
  client.on('end', () => {
    if (stopping) return;
    log('[DAEMON LOCK] conexão encerrada (end)', 'WARN');
    if (lockClient === client) lockClient = null;
    clearDaemonReconnect();
    reconnectTimer = setTimeout(() => tryReconnectLock().catch(e => log(`Reconexão daemon end falhou: ${e.message}`, 'ERROR')), 3000);
  });
}

async function tryReconnectLock() {
  if (stopping) return;
  clearDaemonReconnect();
  try {
    if (lockClient) { try { lockClient.release(true); } catch {} lockClient = null; }
    lockClient = await acquireDaemonLock();
    bindLockClientHandlers(lockClient);
    log('[DAEMON LOCK] reconectado com sucesso', 'INFO');
  } catch (e) {
    log(`[DAEMON LOCK] reconexão falhou: ${e.message}. Nova tentativa em 5s...`, 'ERROR');
    reconnectTimer = setTimeout(() => tryReconnectLock().catch(() => {}), 5000);
  }
}
function json(res, status, body) {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store' });
  res.end(JSON.stringify(body));
}
function authenticated(req) {
  const actual = Buffer.from(String(req.headers['x-munera-token'] || ''));
  const expected = Buffer.from(config.token);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 65536) throw new Error('Corpo HTTP maior que 64 KiB');
  }
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON objeto obrigatório');
  return parsed;
}
function view(job) {
  const running = runningJobs();
  return { id:job.id, name:job.name, script:job.script_path, times:job.times,
    enabled:job.enabled, timeoutSeconds:job.timeout_seconds, nextRuns:job.next_runs || [],
    running:running.has(job.id), pid:running.get(job.id) || null,
    createdAt:job.created_at, updatedAt:job.updated_at };
}
function validTimeout(raw) {
  const value = Number(raw ?? config.timeoutSeconds);
  if (!Number.isInteger(value) || value < 1 || value > 86400) throw new Error('timeoutSeconds: 1 a 86400');
  return value;
}
async function handler(req, res) {
  if (!authenticated(req)) return json(res, 401, { error:'Token inválido' });
  try {
    const url = new URL(req.url, `http://${config.host}:${config.port}`);
    const pathname = url.pathname;
    if (req.method === 'POST' && pathname === '/shutdown') {
      json(res,202,{message:'Encerramento solicitado'});
      setImmediate(() => shutdown('API').catch(e => log(e.message,'ERROR')));
      return;
    }
    if (req.method === 'GET' && pathname === '/health') return json(res,200,{
      online:true,pid:process.pid,startedAt,running:runningCount() });
    if (req.method === 'GET' && pathname === '/jobs') return json(res,200,{
      jobs:(await listJobs()).map(view) });
    if (req.method === 'POST' && pathname === '/jobs') {
      const input = await body(req);
      const script = resolveScript(input.script);
      const times = parseTimes(input.times);
      const job = await upsertJob({ id:randomUUID(), name:safeName(script), script,
        times,timeoutSeconds:validTimeout(input.timeoutSeconds) });
      log(`CADASTRO ${job.id} ${script} horários=${job.times.join(',')}`);
      return json(res,201,{ job:view(job) });
    }
    const match = /^\/jobs\/([0-9a-f-]{36})(?:\/(run|executions))?$/.exec(pathname);
    if (!match) return json(res,404,{error:'Rota não encontrada'});
    const [,id,action] = match;
    if (req.method === 'GET' && action === 'executions') return json(res,200,{
      executions:await recentExecutions(id) });
    if (req.method === 'POST' && action === 'run') {
      const job = await getJob(id);
      if (!job) return json(res,404,{error:'Tarefa não encontrada'});
      const result = await execute(job,'manual');
      return json(res,result.accepted?202:409,result);
    }
    if (req.method === 'PATCH' && !action) {
      const input = await body(req), patch = {};
      if ('times' in input) patch.times = parseTimes(input.times);
      if ('enabled' in input) {
        if (typeof input.enabled !== 'boolean') throw new Error('enabled deve ser booleano');
        patch.enabled = input.enabled;
      }
      if ('timeoutSeconds' in input) patch.timeoutSeconds = validTimeout(input.timeoutSeconds);
      const job = await updateJob(id,patch);
      if (!job) return json(res,404,{error:'Tarefa não encontrada'});
      log(`ATUALIZADO ${id}`);
      return json(res,200,{job:view(job)});
    }
    if (req.method === 'DELETE' && !action) {
      // Remover o cadastro não mata uma execução já em andamento.
      const deleted = await deleteJob(id);
      if (!deleted) return json(res,404,{error:'Tarefa não encontrada'});
      log(`REMOVIDO ${id}`);
      return json(res,200,{deleted:true});
    }
    return json(res,405,{error:'Método não permitido'});
  } catch (error) {
    const badInput = error instanceof SyntaxError || /inválid|obrigat|não encontrad|fora de|Extensão|timeout|maior que|vazia|inteiro/i.test(error.message);
    log(`HTTP ${req.method} ${req.url}: ${error.message}`, 'ERROR');
    return json(res,badInput?400:500,{error:error.message});
  }
}
async function tick() {
  if (stopping || ticking || !lockClient) return;
  ticking = true;
  try {
    // Heartbeat na conexão que possui o advisory lock: se cair, reconecta.
    await lockClient.query('SELECT 1');
    for (const due of await claimDue()) {
      if (Date.now() - new Date(due.scheduled_at).getTime() > 60000) {
        log(`[${due.name}] Horário ${due.time_hhmm} perdido enquanto offline; pulado`, 'WARN');
        continue;
      }
      await execute({ id:due.job_id,name:due.name,script_path:due.script_path,
        timeout_seconds:due.timeout_seconds }, `agendamento ${due.time_hhmm}`).catch(e => log(`EXECUTE ${due.job_id}: ${e.message}`, 'ERROR'));
    }
  } catch (error) {
    log(`SCHEDULER: ${error.message}`, 'ERROR');
    if (lockClient && /terminat|connect|closed|ECONN|socket|reset|timeout|idle_limit|read data/i.test(error.message)) {
      clearDaemonReconnect();
      reconnectTimer = setTimeout(() => tryReconnectLock().catch(e => log(`Tick reconexão falhou: ${e.message}`, 'ERROR')), 2000);
    }
  }
  finally { ticking = false; }
}
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  clearDaemonReconnect();
  log(`Encerramento solicitado: ${signal}`);
  clearInterval(ticker);
  server?.close();
  stopChildren();
  await new Promise(resolve => setTimeout(resolve,config.shutdownGraceMs));
  try { await releaseDaemonLock(lockClient).catch(() => {}); await pool.end().catch(() => {}); }
  catch (error) { log(`Encerramento do banco: ${error.message}`, 'ERROR'); }
  process.exit(0);
}
export async function serve() {
  if (config.token.length < 24 || config.token.includes('SUBSTITUA')) {
    throw new Error('Configure MUNERA_API_TOKEN com pelo menos 24 caracteres aleatórios no .env');
  }
  await checkDatabase();
  lockClient = await acquireDaemonLock();
  bindLockClientHandlers(lockClient);
  await markInterrupted();
  server = http.createServer((req,res) => { handler(req,res).catch(e => {
    log(`HTTP fatal: ${e.message}`,'ERROR'); if (!res.headersSent) json(res,500,{error:'Erro interno'});
  }); });
  await new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(config.port,config.host,resolve);
  });
  log(`ONLINE PID=${process.pid} endereço=http://${config.host}:${config.port} fuso=${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  ticker = setInterval(tick,config.pollMs);
  await tick();
  process.on('SIGINT',()=>shutdown('SIGINT'));
  process.on('SIGTERM',()=>shutdown('SIGTERM'));
}
