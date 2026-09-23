// CLI: traduz comandos humanos em chamadas à API local autenticada.
// Nunca escreve diretamente no banco: somente o daemon faz as alterações.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config, ROOT } from './config.js';
import { parseTimes, resolveScript } from './util.js';
const DAEMON_LOG = path.join(config.logDir, 'daemon.log');

function help() {
  console.log(`
MUNERA v3 — PostgreSQL + scripts Node/PHP/BAT/PowerShell/SH

  munera start                          Inicia daemon em segundo plano
  munera serve                          Executa daemon no terminal
  munera status                         Status do daemon
  munera add ./scripts/teste.php "03:00, 15:00"
  munera ./scripts/teste.js "23:30"     Atalho para add
  munera list                           Lista tarefas
  munera run <id>                       Executa imediatamente
  munera pause <id>                     Pausa agendamento
  munera resume <id>                    Reativa agendamento
  munera time <id> "08:00, 18:00"       Substitui horários
  munera timeout <id> 1800              Timeout em segundos
  munera history <id>                   Últimas 20 execuções
  munera logs <id>                      Mostra caminho do último log
  munera remove <id>                    Remove cadastro
  munera stop                           Encerra daemon

  Configuração: ${path.join(ROOT,'.env')}
  Logs: ${config.logDir}
`);
}
async function request(method, route, data) {
  const response = await fetch(`http://${config.host}:${config.port}${route}`, {
    method,
    headers: { 'x-munera-token':config.token,'content-type':'application/json' },
    body:data===undefined?undefined:JSON.stringify(data),
    signal:AbortSignal.timeout(5000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
async function online() {
  try { return await request('GET','/health'); } catch { return null; }
}
async function start() {
  const existing = await online();
  if (existing) return console.log(`[MUNERA] Já está online PID=${existing.pid}`);
  fs.mkdirSync(config.logDir,{recursive:true});
  const fd = fs.openSync(DAEMON_LOG,'a');
  // detached + unref: o CLI retorna, mas o daemon continua em execução.
  const child = spawn(process.execPath,[path.join(ROOT,'index.js'),'serve'], {
    detached:true,cwd:ROOT,env:{...process.env},stdio:['ignore',fd,fd],windowsHide:true
  });
  fs.closeSync(fd);
  child.unref();
  console.log(`[MUNERA] Iniciando PID=${child.pid}...`);
  for (let attempt=0;attempt<40;attempt++) {
    await new Promise(resolve=>setTimeout(resolve,250));
    const status = await online();
    if (status) return console.log(`[MUNERA] ONLINE PID=${status.pid} | ${DAEMON_LOG}`);
  }
  throw new Error(`Daemon não respondeu. Consulte ${DAEMON_LOG} (banco, token, porta ou SQL).`);
}
export async function cli(args) {
  const [command,first,second] = args;
  if (!command || ['help','--help','-h'].includes(command)) return help();
  if (command==='start') return start();
  if (command==='status') {
    const health = await online();
    return console.log(health ? `[MUNERA] ONLINE PID=${health.pid} ativos=${health.running} desde=${health.startedAt}` : '[MUNERA] OFFLINE');
  }
  if (command==='stop') {
    const status=await online();
    if (!status) return console.log('[MUNERA] Já está offline');
    return console.log((await request('POST','/shutdown')).message);
  }
  if (command==='list') {
    const {jobs}=await request('GET','/jobs');
    if (!jobs.length) return console.log('[MUNERA] Nenhuma tarefa');
    for (const job of jobs) {
      console.log(`\n[${job.id}] ${job.name} | ${job.enabled?'ATIVO':'PAUSADO'} | ${job.running?'EXECUTANDO PID='+job.pid:'AGUARDANDO'}`);
      console.log(`  script: ${job.script}\n  horários: ${job.times.join(', ')}\n  timeout: ${job.timeoutSeconds}s`);
      for (const next of job.nextRuns) console.log(`  próxima ${next.time}: ${new Date(next.at).toLocaleString()}`);
    }
    return;
  }
  if (command==='add' || (!['run','pause','resume','time','timeout','history','logs','remove','serve'].includes(command) && !command.startsWith('-'))) {
    const scriptInput = command==='add'?first:command;
    const rawTimes = command==='add'?second:first;
    if (!scriptInput || !rawTimes) throw new Error('Uso: munera add ./scripts/a.php "03:00, 15:00"');
    const script = resolveScript(scriptInput);
    const {job}=await request('POST','/jobs',{script,times:parseTimes(rawTimes).join(',')});
    return console.log(`[MUNERA] CADASTRADO ${job.id} ${job.script} horários=${job.times.join(',')}`);
  }
  if (!first && command!=='serve') throw new Error(`Informe o ID: munera ${command} <id>`);
  const route=`/jobs/${encodeURIComponent(first)}`;
  if (command==='run') return console.log('[MUNERA] EXECUÇÃO',await request('POST',`${route}/run`));
  if (command==='pause'||command==='resume') return console.log('[MUNERA] ATUALIZADO',(await request('PATCH',route,{enabled:command==='resume'})).job);
  if (command==='time') return console.log('[MUNERA] HORÁRIOS',(await request('PATCH',route,{times:parseTimes(second).join(',')})).job);
  if (command==='timeout') return console.log('[MUNERA] TIMEOUT',(await request('PATCH',route,{timeoutSeconds:Number(second)})).job);
  if (command==='remove') return console.log('[MUNERA] REMOVIDO',await request('DELETE',route));
  if (command==='history'||command==='logs') {
    const {executions}=await request('GET',`${route}/executions`);
    if (!executions.length) return console.log('[MUNERA] Nenhuma execução registrada');
    if (command==='logs') return console.log(executions.find(x=>x.log_path)?.log_path || 'Nenhum log');
    for (const x of executions) console.log(`${x.started_at} ${x.status} code=${x.exit_code ?? '-'} ${x.reason} ${x.log_path || ''}`);
    return;
  }
  throw new Error(`Comando desconhecido: ${command}. Use munera --help`);
}
