/** Regras comuns: caminhos, horários, executável e cálculo do próximo disparo. */
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
export function times(input) {
  const items = Array.isArray(input) ? input : String(input || '').split(',');
  const out = new Set();
  for (const raw of items) {
    const v = String(raw).trim();
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v);
    if (!m) throw new Error(`Horário inválido: ${v}. Use HH:mm`);
    out.add(`${m[1].padStart(2, '0')}:${m[2]}`);
  }
  if (!out.size) throw new Error('Informe ao menos um horário');
  return [...out].sort();
}
export function nextAt(time, from = new Date()) {
  // TZ é definida ANTES da inicialização pelo .env e usada pelo Node nos cálculos locais.
  const [hh, mm] = time.split(':').map(Number);
  const next = new Date(from);
  next.setHours(hh, mm, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  return next;
}
export function resolveScript(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Caminho de script obrigatório');
  const full = fs.realpathSync(path.resolve(input)); // resolve symlinks para evitar fuga da raiz
  if (!fs.statSync(full).isFile()) throw new Error('Script não é arquivo');
  const allowed = cfg.scriptRoots.some(root => {
    const realRoot = fs.realpathSync(root);
    return full === realRoot || full.startsWith(realRoot + path.sep);
  });
  if (!allowed) throw new Error(`Script fora de SCRIPT_ROOTS: ${full}`);
  const ext = path.extname(full).toLowerCase();
  if (!cfg.bins[ext]) throw new Error(`Extensão não suportada: ${ext}`);
  if ((ext === '.bat' || ext === '.cmd') && process.platform !== 'win32') throw new Error('.bat/.cmd exigem Windows');
  return full;
}
export function validateArgs(args) {
  if (!Array.isArray(args) || args.length > 50 || args.some(x => typeof x !== 'string' || x.length > 4096))
    throw new Error('args deve ser array de até 50 strings');
  return args;
}
export function validateEnv(env) {
  if (!env || Array.isArray(env) || typeof env !== 'object') throw new Error('env deve ser objeto');
  for (const [k, v] of Object.entries(env)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== 'string' || v.length > 4096)
      throw new Error(`Variável de ambiente inválida: ${k}`);
    if (/^(PATH|NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH)$/i.test(k)) throw new Error(`Variável reservada: ${k}`);
  }
  return env;
}
export function commandFor(script, args = []) {
  const ext = path.extname(script).toLowerCase();
  const bin = cfg.bins[ext];
  if (ext === '.ps1') return { bin, args: ['-NoProfile', '-NonInteractive', '-File', script, ...args] };
  if (ext === '.bat' || ext === '.cmd') {
    if (args.length) {
      throw new Error('Munera V3 não aceita args em .bat/.cmd por segurança');
    }

    return {
      bin,
      args: ['/d', '/s', '/c', `""${script}""`],
      windowsVerbatimArguments: true
    };
  }
  return { bin, args: [script, ...args] };
}
