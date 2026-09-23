/** Configuração única: .env carregado a partir da raiz, independente do cwd do terminal. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(ROOT, '.env') });

function int(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} inválido: ${raw}`);
  return value;
}
const abs = value => path.resolve(ROOT, value);
const roots = (process.env.SCRIPT_ROOTS || './scripts').split(';').map(s => s.trim()).filter(Boolean).map(abs);
export const cfg = Object.freeze({
  timezone: process.env.TZ || 'America/Sao_Paulo',
  host: process.env.API_HOST || '127.0.0.1',
  port: int('API_PORT', 47831, 1, 65535),
  token: process.env.API_TOKEN || '',
  cors: (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
  pg: {
    host: process.env.PGHOST || '127.0.0.1', port: int('PGPORT', 5432, 1, 65535),
    database: process.env.PGDATABASE || 'muneradb', user: process.env.PGUSER || 'munera_app',
    password: process.env.PGPASSWORD || '', max: int('PGPOOL_MAX', 10, 1, 100),
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: true } : false
  },
  logDir: abs(process.env.LOG_DIR || './src/log'), scriptRoots: roots,
  pollMs: int('SCHEDULER_POLL_MS', 1000, 250, 60000),
  timeout: int('DEFAULT_TIMEOUT_SECONDS', 3600, 1, 86400),
  maxConcurrent: int('MAX_CONCURRENT', 4, 1, 100),
  logMaxBytes: int('LOG_MAX_BYTES', 104857600, 1024, 1073741824),
  bins: { '.js': process.env.NODE_BIN || 'node', '.mjs': process.env.NODE_BIN || 'node',
    '.cjs': process.env.NODE_BIN || 'node', '.php': process.env.PHP_BIN || 'php',
    '.ps1': process.env.POWERSHELL_BIN || 'pwsh', '.sh': process.env.BASH_BIN || 'bash',
    '.bat': process.env.CMD_BIN || 'cmd.exe', '.cmd': process.env.CMD_BIN || 'cmd.exe' }
});
export function validateConfig() {
  if (cfg.token.length < 32 || cfg.token.startsWith('COLOQUE_')) throw new Error('Defina API_TOKEN forte (>=32 caracteres) no .env');
  if (!cfg.pg.password) throw new Error('Defina PGPASSWORD no .env');
  if (!fs.existsSync(path.join(ROOT, '.env'))) throw new Error('Crie .env copiando .env.example');
  new Intl.DateTimeFormat('en-US', { timeZone: cfg.timezone });
}
export function log(message, level = 'INFO') { console.log(`[${new Date().toISOString()}] [${level}] ${message}`); }
