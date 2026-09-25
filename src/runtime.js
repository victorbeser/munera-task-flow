/** Regras comuns: caminhos, horários, executável e cálculo do próximo disparo. */
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';

export function isDateTimeInput(input) {
  if (typeof input !== 'string') return false;
  const v = input.trim();
  return /\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/.test(v) && /\d{1,2}[:\-]\d{2}/.test(v);
}

export function parseDateTime(input) {
  const v = String(input || '').trim();
  const patterns = [
    { re: /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\s+(\d{1,2})[:\-](\d{2})$/, order: ['d', 'm', 'y', 'h', 'mi'] },
    { re: /^(\d{1,2})[:\-](\d{2})\s+(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/, order: ['h', 'mi', 'd', 'm', 'y'] },
  ];
  for (const p of patterns) {
    const m = p.re.exec(v);
    if (m) {
      const parts = {};
      p.order.forEach((k, i) => { parts[k] = parseInt(m[i + 1], 10); });
      let year = parts.y;
      if (year < 100) year += 2000;
      const d = new Date(year, parts.m - 1, parts.d, parts.h, parts.mi, 0, 0);
      if (isNaN(d.getTime())) continue;
      if (d.getDate() !== parts.d || d.getMonth() !== parts.m - 1 || d.getFullYear() !== year) continue;
      if (d.getHours() !== parts.h || d.getMinutes() !== parts.mi) continue;
      return d;
    }
  }
  throw new Error(`Data/hora inválida: ${v}. Formatos aceitos: DD/MM/YYYY HH:mm, DD-MM-YYYY HH:mm, HH:mm DD/MM/YYYY`);
}

export function times(input) {
  const items = Array.isArray(input) ? input : String(input || '').split(',');
  const out = new Set();
  for (const raw of items) {
    const v = String(raw).trim();
    if (isDateTimeInput(v)) continue;
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(v);
    if (!m) throw new Error(`Horário inválido: ${v}. Use HH:mm`);
    out.add(`${m[1].padStart(2, '0')}:${m[2]}`);
  }
  return [...out].sort();
}

export function nextAt(time, from = new Date()) {
  const [hh, mm] = time.split(':').map(Number);
  const next = new Date(from);
  next.setHours(hh, mm, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  return next;
}

export function nextAtDateTime(dateTime, periodDays, from = new Date()) {
  const base = new Date(dateTime);
  if (isNaN(base.getTime())) throw new Error('Datetime inválido');
  if (periodDays == null) {
    return base;
  }
  const period = Number(periodDays);
  if (!Number.isInteger(period) || period <= 0) throw new Error('period deve ser inteiro positivo (dias)');
  if (base > from) return base;
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffMs = from.getTime() - base.getTime();
  const diffDays = Math.floor(diffMs / msPerDay);
  const cycles = Math.floor(diffDays / period) + 1;
  const next = new Date(base.getTime() + cycles * period * msPerDay);
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
