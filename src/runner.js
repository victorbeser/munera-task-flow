/** Executor: cada script em processo filho, log em arquivo e status persistido no PG. */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { cfg, log } from './config.js';
import { query } from './db.js';
import { commandFor } from './runtime.js';
export const events = new EventEmitter();
events.setMaxListeners(1000);
const running = new Map(); // jobId -> { child, executionId, timer, cancelReason }
export const activeCount = () => running.size;
export const isRunning = id => running.has(Number(id));
export function emit(type, data) { events.emit('event', { type, at: new Date().toISOString(), ...data }); }
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const safeName = name => name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'script';
function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    // taskkill encerra também subprocessos criados por .bat e PowerShell.
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch { try { child.kill('SIGTERM'); } catch { } }
    const t = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { } }, 5000);
    t.unref();
  }
}
export function cancel(id, reason = 'cancelled') {
  const entry = running.get(Number(id));
  if (!entry) return false;
  entry.cancelReason = reason;
  killTree(entry.child);
  emit('execution.cancel_requested', { jobId: Number(id), executionId: entry.executionId, reason });
  return true;
}
export async function run(job, trigger = 'manual') {
  const id = Number(job.id);
  if (running.has(id)) return { accepted: false, reason: 'already_running' };
  if (running.size >= cfg.maxConcurrent) return { accepted: false, reason: 'capacity' };
  // Reserva o slot antes do primeiro await: impede disparos concorrentes no mesmo daemon.
  const entry = { child: null, executionId: null, timer: null, cancelReason: null };
  running.set(id, entry);
  let ws = null, file = null;
  const started = Date.now();
  try {
    const folder = path.join(cfg.logDir, `${safeName(job.name)}-${id}`);
    fs.mkdirSync(folder, { recursive: true });
    file = path.join(folder, `log-${stamp()}-${process.pid}.txt`);
    ws = fs.createWriteStream(file, { flags: 'wx' });
    const result = await query(`INSERT INTO munera.executions(job_id,job_name,script_path,trigger,status,log_path)
      VALUES($1,$2,$3,$4,'running',$5) RETURNING id`, [id, job.name, job.script_path, trigger, file]);
    entry.executionId = Number(result.rows[0].id);
    const command = commandFor(job.script_path, job.args || []);
    ws.write(`[START ${new Date().toISOString()}] job=${id} execution=${entry.executionId} trigger=${trigger} script=${job.script_path}\n`);
    const child = spawn(command.bin, command.args, {
      cwd: path.dirname(job.script_path),
      env: { ...process.env, ...(job.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
      shell: false,
      windowsVerbatimArguments: command.windowsVerbatimArguments || false
    });
    entry.child = child;
    const seconds = job.timeout_seconds || cfg.timeout;
    entry.timer = setTimeout(() => cancel(id, 'timeout'), seconds * 1000);
    entry.timer.unref();
    // Registra PID sem deixar uma falha do banco abandonar um processo já iniciado.
    try { await query('UPDATE munera.executions SET pid=$1 WHERE id=$2', [child.pid || null, entry.executionId]); }
    catch (e) { log(`Falha ao registrar PID: ${e.message}`, 'ERROR'); }
    emit('execution.started', { jobId: id, executionId: entry.executionId, pid: child.pid, trigger });
    log(`[${job.name} #${id}] INICIADO PID=${child.pid} execução=${entry.executionId} log=${file}`);
    let size = 0, truncated = false, spawnError = null;
    const output = (stream, chunk) => {
      const str = chunk.toString('utf8');
      if (size < cfg.logMaxBytes) {
        const allowed = Math.max(0, cfg.logMaxBytes - size);
        ws.write(chunk.subarray(0, allowed));
        size += Math.min(allowed, chunk.length);
      } else if (!truncated) { ws.write('\n[LOG TRUNCADO: limite LOG_MAX_BYTES]\n'); truncated = true; }
      const preview = str.slice(0, 8192);
      emit('execution.output', { jobId: id, executionId: entry.executionId, stream, text: preview });
      (stream === 'stderr' ? process.stderr : process.stdout).write(`[${job.name} ${stream}] ${str}`);
    };
    child.stdout.on('data', c => output('stdout', c));
    child.stderr.on('data', c => output('stderr', c));
    child.on('error', e => { spawnError = e; log(`[${job.name}] ${e.message}`, 'ERROR'); });
    const { code, signal } = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
    const status = entry.cancelReason === 'timeout' ? 'timeout'
      : entry.cancelReason ? 'cancelled' : spawnError || code !== 0 ? 'failed' : 'success';
    const error = spawnError?.message || null;
    ws.end(`\n[END ${new Date().toISOString()}] status=${status} code=${code} signal=${signal || '-'} duration_ms=${Date.now() - started}\n`);
    await new Promise(resolve => ws.once('finish', resolve));
    await query(`UPDATE munera.executions SET status=$1,exit_code=$2,signal=$3,error_message=$4,finished_at=now()
      WHERE id=$5`, [status, code, signal, error, entry.executionId]);
    emit('execution.finished', { jobId: id, executionId: entry.executionId, status, code, signal });
    log(`[${job.name} #${id}] FINALIZADO status=${status} code=${code} duration=${Date.now() - started}ms`);
    return { accepted: true, executionId: entry.executionId, status };
  } catch (e) {
    if (ws && !ws.destroyed) ws.end(`\n[ERRO ${new Date().toISOString()}] ${e.message}\n`);
    if (entry.executionId) {
      try { await query(`UPDATE munera.executions SET status='failed',error_message=$1,finished_at=now() WHERE id=$2`, [e.message, entry.executionId]); } catch { }
    }
    emit('execution.error', { jobId: id, executionId: entry.executionId, error: e.message });
    log(`[${job.name} #${id}] ${e.stack || e.message}`, 'ERROR');
    return { accepted: false, reason: e.message };
  } finally {
    if (entry.timer) clearTimeout(entry.timer);
    running.delete(id);
  }
}
export async function shutdownRuns() {
  for (const id of [...running.keys()]) cancel(id, 'cancelled');
  const until = Date.now() + 10000;
  while (running.size && Date.now() < until) await new Promise(r => setTimeout(r, 100));
}
