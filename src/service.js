/** Scheduler: um único dono do lock PostgreSQL, horários persistidos por job. */
import { cfg, log } from './config.js';
import { pool, query, transaction, audit, attachClientErrorHandler } from './db.js';
import { times, nextAt, resolveScript, validateArgs, validateEnv } from './runtime.js';
import { run, isRunning, activeCount, emit } from './runner.js';


const LOCK_KEY = 79134602; // número fixo: só uma instância Munera por banco.
let lockClient, interval, busy = false, stopping = false, reconnectTimer = null;

function clearReconnectTimer() {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
}

async function acquireLock() {
  const client = await pool.connect();
  attachClientErrorHandler(client, 'lock');
  client.on('error', (err) => {
    log(`[LOCK] conexão perdida: ${err.code || ''} ${err.message}. Agendando reconexão...`, 'ERROR');
    if (stopping) return;
    try { client.release(true); } catch {}
    if (lockClient === client) { lockClient = null; }
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => restartScheduler().catch(e => log(`Reagendamento reconexão falhou: ${e.message}`, 'ERROR')), 2000);
  });
  client.on('end', () => {
    if (stopping) return;
    log('[LOCK] conexão encerrada (end). Agendando reconexão...', 'WARN');
    if (lockClient === client) { lockClient = null; }
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => restartScheduler().catch(e => log(`Reagendamento reconexão falhou: ${e.message}`, 'ERROR')), 2000);
  });
  const result = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [LOCK_KEY]);
  if (!result.rows[0].acquired) {
    try { client.release(); } catch {}
    throw new Error('Já existe outro Munera ativo neste banco (advisory lock)');
  }
  return client;
}

export async function startScheduler() {
  stopping = false;
  lockClient = await acquireLock();
  try {
    await query(`UPDATE munera.executions SET status='interrupted',finished_at=now(),
      error_message='Munera reiniciado antes de concluir a execução' WHERE status='running'`);
    if (interval) clearInterval(interval);
    interval = setInterval(() => tick().catch(e => log(`Scheduler: ${e.stack || e.message}`, 'ERROR')), cfg.pollMs);
    interval.unref();
    await tick();
    log(`Scheduler ativo | poll=${cfg.pollMs}ms | timezone=${cfg.timezone}`);
  } catch (e) {
    try { lockClient?.release(true); } catch {}
    lockClient = null;
    throw e;
  }
}

async function restartScheduler(attempt = 0) {
  if (stopping) return;
  clearReconnectTimer();
  if (lockClient) {
    try { lockClient.release(true); } catch {}
    lockClient = null;
  }
  try {
    log(`[LOCK] tentativa ${attempt + 1} de retomar lock e scheduler...`, 'WARN');
    await startScheduler();
    log('[LOCK] scheduler retomado com sucesso', 'INFO');
  } catch (e) {
    log(`[LOCK] retomada falhou: ${e.message}. Tentando novamente em 5s...`, 'ERROR');
    reconnectTimer = setTimeout(() => restartScheduler(attempt + 1).catch(() => {}), 5000);
  }
}

export async function stopScheduler() {
  stopping = true;
  clearReconnectTimer();
  if (interval) { clearInterval(interval); interval = null; }
  if (lockClient) {
    try { await lockClient.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {}); } catch {}
    try { lockClient.release(true); } catch {}
    lockClient = null;
  }
}

async function tick() {
  if (busy || !lockClient) return;
  busy = true;
  try {
    try {
      await lockClient.query('SELECT 1');
    } catch (heartbeatErr) {
      log(`[LOCK] heartbeat falhou: ${heartbeatErr.message}. Disparando reconexão...`, 'ERROR');
      throw heartbeatErr;
    }
    const due = await query(`SELECT s.job_id,s.time_hhmm,j.* FROM munera.job_schedules s
      JOIN munera.jobs j ON j.id=s.job_id WHERE j.enabled=true AND s.next_run_at <= now()
      ORDER BY s.next_run_at LIMIT 100`);
    for (const row of due.rows) {
      const next = nextAt(row.time_hhmm);
      await query('UPDATE munera.job_schedules SET next_run_at=$1 WHERE job_id=$2 AND time_hhmm=$3',
        [next, row.job_id, row.time_hhmm]);
      if (isRunning(row.job_id) || activeCount() >= cfg.maxConcurrent) {
        log(`[${row.name}] IGNORADO ${row.time_hhmm}: sobreposição ou limite de concorrência`, 'WARN');
        await query(`INSERT INTO munera.executions(job_id,job_name,script_path,trigger,status,finished_at,error_message)
          VALUES($1,$2,$3,$4,'skipped',now(),$5)`,
          [row.job_id, row.name, row.script_path, `schedule ${row.time_hhmm}`, 'already_running_or_capacity']);
        emit('execution.skipped', { jobId: Number(row.job_id), time: row.time_hhmm });
        continue;
      }
      void run(row, `schedule ${row.time_hhmm}`).catch(e => log(`[RUN ${row.name}] ${e.message}`, 'ERROR'));
    }
  } catch (tickErr) {
    log(`SCHEDULER tick: ${tickErr.message}`, 'ERROR');
    if (!stopping && lockClient && /terminat|connect|closed|ECONN|socket|reset|timeout|idle_limit|read data/i.test(tickErr.message)) {
      clearReconnectTimer();
      reconnectTimer = setTimeout(() => restartScheduler().catch(e => log(`Reconexão tick falhou: ${e.message}`, 'ERROR')), 2000);
    }
  } finally { busy = false; }
}
export async function listJobs() {
  const result = await query(`SELECT j.*, COALESCE((SELECT json_agg(json_build_object('time',time_hhmm,'next',next_run_at)
    ORDER BY time_hhmm) FROM munera.job_schedules WHERE job_id=j.id),'[]'::json) AS schedules,
    (SELECT status FROM munera.executions e WHERE e.job_id=j.id ORDER BY id DESC LIMIT 1) AS last_status
    FROM munera.jobs j ORDER BY j.id`);
  return result.rows.map(row => ({ ...row, running: isRunning(row.id) }));
}
export async function getJob(id) {
  const result = await query('SELECT * FROM munera.jobs WHERE id=$1', [id]);
  if (!result.rows.length) throw Object.assign(new Error('Tarefa não encontrada'), { status: 404 });
  return result.rows[0];
}
export async function addJob(body) {
  const script = resolveScript(body.script);
  const name = String(body.name || script.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')).slice(0, 150);
  if (!name) throw new Error('Nome obrigatório');
  const schedule = times(body.times);
  const args = validateArgs(body.args || []), env = validateEnv(body.env || {});
  const timeout = body.timeout_seconds ?? cfg.timeout;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 86400) throw new Error('timeout_seconds inválido');
  const job = await transaction(async client => {
    const found = await client.query('SELECT id FROM munera.jobs WHERE script_path=$1 FOR UPDATE', [script]);
    let id;
    if (found.rows.length) {
      id = found.rows[0].id;
      await client.query(`UPDATE munera.jobs SET name=$1,args=$2::jsonb,env=$3::jsonb,
        times=(SELECT ARRAY(SELECT DISTINCT unnest(times || $4::text[]) ORDER BY 1)),enabled=true,
        timeout_seconds=$5,updated_at=now() WHERE id=$6`,
        [name, JSON.stringify(args), JSON.stringify(env), schedule, timeout, id]);
    } else {
      const r = await client.query(`INSERT INTO munera.jobs(name,script_path,args,env,times,timeout_seconds)
        VALUES($1,$2,$3::jsonb,$4::jsonb,$5,$6) RETURNING id`,
        [name, script, JSON.stringify(args), JSON.stringify(env), schedule, timeout]);
      id = r.rows[0].id;
    }
    for (const time of schedule) await client.query(`INSERT INTO munera.job_schedules(job_id,time_hhmm,next_run_at)
      VALUES($1,$2,$3) ON CONFLICT(job_id,time_hhmm) DO NOTHING`, [id, time, nextAt(time)]);
    return id;
  });
  await audit('job.upsert', job, { script, schedule });
  emit('job.changed', { jobId: Number(job) });
  return getJob(job);
}
export async function updateJob(id, body) {
  const original = await getJob(id);
  const schedule = body.times === undefined ? original.times : times(body.times);
  const name = body.name === undefined ? original.name : String(body.name).trim().slice(0, 150);
  const args = body.args === undefined ? original.args : validateArgs(body.args);
  const env = body.env === undefined ? original.env : validateEnv(body.env);
  const enabled = body.enabled === undefined ? original.enabled : body.enabled;
  const timeout = body.timeout_seconds === undefined ? original.timeout_seconds : body.timeout_seconds;
  if (!name || typeof enabled !== 'boolean' || !Number.isInteger(timeout) || timeout < 1 || timeout > 86400)
    throw new Error('Parâmetros de atualização inválidos');
  await transaction(async client => {
    await client.query(`UPDATE munera.jobs SET name=$1,args=$2::jsonb,env=$3::jsonb,times=$4,
      enabled=$5,timeout_seconds=$6,updated_at=now() WHERE id=$7`,
      [name, JSON.stringify(args), JSON.stringify(env), schedule, enabled, timeout, id]);
    if (body.times !== undefined) {
      await client.query('DELETE FROM munera.job_schedules WHERE job_id=$1', [id]);
      for (const time of schedule) await client.query(`INSERT INTO munera.job_schedules(job_id,time_hhmm,next_run_at)
        VALUES($1,$2,$3)`, [id, time, nextAt(time)]);
    }
  });
  await audit('job.update', id, { fields: Object.keys(body) });
  emit('job.changed', { jobId: Number(id) });
  return getJob(id);
}
export async function removeJob(id) {
  await getJob(id);

  if (isRunning(id)) {
    throw Object.assign(
      new Error('Cancele a execução antes de remover'),
      { status: 409 }
    );
  }

  await transaction(async (client) => {

    // Remove todos os agendamentos da tarefa
    await client.query(
      'DELETE FROM munera.job_schedules WHERE job_id = $1',
      [id]
    );

    // Remove a tarefa
    await client.query(
      'DELETE FROM munera.jobs WHERE id = $1',
      [id]
    );

  });

  await audit('job.delete', id);

  emit('job.deleted', {
    jobId: Number(id)
  });
}
