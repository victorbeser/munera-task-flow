// Funções puras e compartilhadas: normalização de horários, nomes e caminhos.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export function stamp(date = new Date()) {
  const p = (n, len = 2) => String(n).padStart(len, '0');
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}-${p(date.getMilliseconds(),3)}`;
}
export function log(message, level = 'INFO') {
  const line = `[${new Date().toISOString()}] [MUNERA] [${level}] ${message}`;
  (level === 'ERROR' ? console.error : console.log)(line);
}
export function parseTimes(raw) {
  if (typeof raw !== 'string') throw new Error('Informe horários como "03:00, 15:00"');
  const items = raw.split(',').map(x => x.trim());
  if (!items.length || items.some(x => !x)) throw new Error('Lista de horários vazia');
  return [...new Set(items.map(value => {
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
