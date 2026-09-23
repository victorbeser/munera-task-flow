/** HTTP sem Express: API JSON autenticada e SSE (Server-Sent Events). */
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { cfg, log } from './config.js';
import { query, audit } from './db.js';
import { addJob, updateJob, removeJob, getJob, listJobs } from './service.js';
import { run, cancel, events, activeCount, isRunning } from './runner.js';
const clients = new Set();
const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
function authorized(req) {
  const supplied = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(supplied), b = Buffer.from(cfg.token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 1024 * 1024) throw Object.assign(new Error('Body acima de 1 MB'), { status: 413 }); }
  try { return text ? JSON.parse(text) : {}; } catch { throw new Error('JSON inválido'); }
}
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && cfg.cors.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  }
}
function sse(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  clients.add(res);
  const ping = setInterval(() => { if (!res.destroyed) res.write(': ping\n\n'); }, 15000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
}
events.on('event', event => {
  const line = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) if (!res.destroyed) res.write(line);
});
export function createApi() {
  return http.createServer(async (req, res) => {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    // Inclusive /health exige token para não expor informações internas.
    if (!authorized(req)) { send(res, 401, { error: 'Token inválido ou ausente' }); return; }
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      if (req.method === 'GET' && p === '/health') {
        await query('SELECT 1');
        return send(res, 200, { status: 'online', pid: process.pid, running: activeCount(), timezone: cfg.timezone });
      }
      if (req.method === 'GET' && p === '/events') return sse(req, res);
      if (req.method === 'GET' && p === '/jobs') return send(res, 200, { data: await listJobs() });
      if (req.method === 'POST' && p === '/jobs') return send(res, 201, { data: await addJob(await body(req)) });
      const jobMatch = /^\/jobs\/(\d+)(?:\/(run|cancel))?$/.exec(p);
      if (jobMatch) {
        const id = Number(jobMatch[1]), action = jobMatch[2];
        if (req.method === 'GET' && !action) return send(res, 200, { data: await getJob(id) });
        if (req.method === 'PATCH' && !action) return send(res, 200, { data: await updateJob(id, await body(req)) });
        if (req.method === 'DELETE' && !action) { await removeJob(id); return send(res, 200, { ok: true }); }
        if (req.method === 'POST' && action === 'run') {
          const job = await getJob(id);
          // Evita responder 'accepted' quando já sabemos que a execução não caberá.
          if (isRunning(id) || activeCount() >= cfg.maxConcurrent)
            return send(res, 409, { error: 'Script já em execução ou capacidade esgotada' });
          // Resposta imediata; status e stdout chegam pelo SSE /events.
          void run(job, 'manual');
          await audit('job.run', id);
          return send(res, 202, { accepted: true, message: 'Solicitação enviada; acompanhe em /events e /executions' });
        }
        if (req.method === 'POST' && action === 'cancel') return send(res, 200, { cancelled: cancel(id) });
      }
      if (req.method === 'GET' && p === '/executions') {
        const jobId = url.searchParams.get('job_id');
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 30));
        const r = await query(`SELECT * FROM munera.executions WHERE ($1::bigint IS NULL OR job_id=$1)
          ORDER BY id DESC LIMIT $2`, [jobId || null, limit]);
        return send(res, 200, { data: r.rows });
      }
      const logMatch = /^\/executions\/(\d+)\/log$/.exec(p);
      if (req.method === 'GET' && logMatch) {
        const r = await query('SELECT log_path FROM munera.executions WHERE id=$1', [logMatch[1]]);
        if (!r.rows.length) return send(res, 404, { error: 'Execução não encontrada' });
        const file = r.rows[0].log_path;
        if (!file || !fs.existsSync(file)) return send(res, 404, { error: 'Log indisponível' });
        const bytes = Math.min(65536, Math.max(1, Number(url.searchParams.get('tail_bytes')) || 16384));
        const stat = fs.statSync(file), start = Math.max(0, stat.size - bytes);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        return fs.createReadStream(file, { start }).pipe(res);
      }
      send(res, 404, { error: 'Rota não encontrada' });
    } catch (e) {
      log(`API ${req.method} ${req.url}: ${e.stack || e.message}`, 'ERROR');
      send(res, e.status || (e.code === '23505' ? 409 : 400), { error: e.message });
    }
  });
}
