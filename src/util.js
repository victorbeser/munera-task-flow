// Funções puras e compartilhadas: normalização de horários, nomes e caminhos.
import fs from 'node:fs';
import path from 'node:path';
import { cfg as config } from './config.js';

export function stamp(date = new Date()) {
  const p = (n, len = 2) => String(n).padStart(len, '0');
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}-${p(date.getMilliseconds(),3)}`;
}
export function log(message, level = 'INFO') {
  const line = `[${new Date().toISOString()}] [MUNERA] [${level}] ${message}`;
  (level === 'ERROR' ? console.error : console.log)(line);
}

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

export function parseTimes(raw) {
  if (typeof raw !== 'string') throw new Error('Informe horários como "03:00, 15:00"');
  const items = raw.split(',').map(x => x.trim());
  if (!items.length || items.some(x => !x)) throw new Error('Lista de horários vazia');
  return [...new Set(items.map(value => {
    if (isDateTimeInput(value)) return value;
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
    if (!m) throw new Error(`Horário inválido: ${value}. Use HH:mm`);
    return `${m[1].padStart(2,'0')}:${m[2]}`;
  }))].sort();
}
export function nextOccurrence(hhmm, from = new Date()) {
  const [hour, minute] = hhmm.split(':').map(Number);
  const date = new Date(from);
  date.setHours(hour, minute, 0, 0);
  if (date <= from) date.setDate(date.getDate() + 1);
  return date;
}

export function nextOccurrenceDateTime(dateTime, periodDays, from = new Date()) {
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
  if (typeof input !== 'string' || !input.trim()) throw new Error('Caminho do script obrigatório');
  // O CLI envia o caminho absoluto; API também aceita caminho relativo à raiz do Munera.
  const candidate = path.resolve(input);
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
    throw new Error(`Script não encontrado: ${candidate}`);
  }
  const real = fs.realpathSync(candidate); // impede escapar por symlink.
  if (!/\.(js|mjs|cjs|php|bat|cmd|ps1|sh)$/i.test(real)) {
    throw new Error('Extensão não suportada (js,mjs,cjs,php,bat,cmd,ps1,sh)');
  }
  if (config.allowedDirs.length && !config.allowedDirs.some(dir => {
    const rel = path.relative(fs.existsSync(dir) ? fs.realpathSync(dir) : dir, real);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
  })) throw new Error(`Script fora de MUNERA_ALLOWED_SCRIPT_DIRS: ${real}`);
  return real;
}
export function safeName(script) {
  return path.basename(script, path.extname(script)).replace(/[^a-zA-Z0-9_-]/g, '_') || 'script';
}
