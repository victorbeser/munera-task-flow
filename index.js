#!/usr/bin/env node
/** CLI: start mantém serviço; outros comandos consomem a mesma API. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cfg, validateConfig, log } from './src/config.js';
import { pool, setupGlobalErrorHandlers } from './src/db.js';
import { createApi } from './src/api.js';
import { startScheduler, stopScheduler } from './src/service.js';
import { shutdownRuns } from './src/runner.js';

setupGlobalErrorHandlers();

/* ============================================================
 * MUNERA TASK FLOW — CLI BANNER
 * ============================================================ */

const RST = '\x1b[0m';
const BLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITL = '\x1b[3m';

const fg256 = (n) => `\x1b[38;5;${n}m`;

const C = {
  cyan: 51,
  aqua: 45,
  ice: 195,
  blue: 33,
  deep: 27,
  white: 255,
  muted: 250,
  gray: 245,
  green: 48,
  violet: 99
};

/**
 * Converte uma cor ANSI 256 para RGB.
 * Permite criar gradientes corretos entre quaisquer cores da paleta.
 */
function ansi256ToRgb(n) {
  const basic = [
    [0, 0, 0],       [128, 0, 0],     [0, 128, 0],
    [128, 128, 0],   [0, 0, 128],     [128, 0, 128],
    [0, 128, 128],   [192, 192, 192],
    [128, 128, 128], [255, 0, 0],     [0, 255, 0],
    [255, 255, 0],   [0, 0, 255],     [255, 0, 255],
    [0, 255, 255],   [255, 255, 255]
  ];

  if (n < 16) return basic[n];

  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return [v, v, v];
  }

  const x = n - 16;
  const levels = [0, 95, 135, 175, 215, 255];

  return [
    levels[Math.floor(x / 36)],
    levels[Math.floor((x % 36) / 6)],
    levels[x % 6]
  ];
}

function rgb(r, g, b) {
  return `\x1b[38;2;${r};${g};${b}m`;
}

/**
 * Gradiente RGB real.
 * Espaços não consomem a progressão da cor quando skipChars inclui ' '.
 */
function gradient(text, from, to, options = {}) {
  const start = ansi256ToRgb(from);
  const end = ansi256ToRgb(to);

  const skip = options.skipChars || [];
  const chars = [...String(text)];

  const visible = chars.filter(ch => !skip.includes(ch));
  const total = Math.max(visible.length - 1, 1);

  let index = 0;
  let output = '';

  for (const ch of chars) {
    if (skip.includes(ch)) {
      output += ch;
      continue;
    }

    const t = index / total;

    const color = start.map((value, i) =>
      Math.round(value + (end[i] - value) * t)
    );

    output += rgb(...color) + ch;

    index++;
  }

  return output + RST;
}

/**
 * Remove sequências ANSI para calcular corretamente
 * a largura visual de cada linha.
 */
function visibleLength(text) {
  return [...String(text).replace(/\x1b\[[0-9;]*m/g, '')].length;
}

/* ============================================================
 * BANNER
 * ============================================================ */

function printMuneraBanner() {

  const WIDTH = 100;

  const border = (text) => gradient(text, C.cyan, C.deep, {
    skipChars: [' ']
  });

  const top =
    '╭' + '─'.repeat(WIDTH) + '╮';

  const bottom =
    '╰' + '─'.repeat(WIDTH) + '╯';

  const separator =
    '├' + '─'.repeat(WIDTH) + '┤';

  function line(content = '', indent = 0) {
    const prefix = ' '.repeat(indent);

    const used = visibleLength(prefix + content);

    const padding = ' '.repeat(
      Math.max(0, WIDTH - used)
    );

    console.log(
      fg256(C.cyan) + '│' + RST +
      prefix +
      content +
      padding +
      fg256(C.blue) + '│' + RST
    );
  }

  function centered(content) {
    const length = visibleLength(content);

    const left = Math.max(
      0,
      Math.floor((WIDTH - length) / 2)
    );

    line(content, left);
  }

  /* ----------------------------------------------------------
   * LOGO ASCII
   *
   * M geométrico + relógio + linhas de movimento.
   * Inspirado na identidade visual do Munera Task Flow.
   * ---------------------------------------------------------- */

  const logo = [
    '  ██╗        ██╗',
    '  ███╗      ███║',
    '  ████╗    ████║',
    '  ██╔██╗  ██╔██║',
    '  ██║╚██╗██╔╝██║',
    '  ██║ ╚███╔╝ ██║',
    '  ██║  ╚█╔╝  ██║',
    '  ██║        ██║',
    '  ██║   ━━━  ╭─────╮',
    '  ██║  ━━━━━ │  ╷  │',
    '  ╚═╝   ━━━  │  ╰╮ │',
    '             ╰─────╯'
  ];

  const title = [
    '███╗   ███╗██╗   ██╗███╗   ██╗███████╗██████╗  █████╗ ',
    '████╗ ████║██║   ██║████╗  ██║██╔════╝██╔══██╗██╔══██╗',
    '██╔████╔██║██║   ██║██╔██╗ ██║█████╗  ██████╔╝███████║',
    '██║╚██╔╝██║██║   ██║██║╚██╗██║██╔══╝  ██╔══██╗██╔══██║',
    '██║ ╚═╝ ██║╚██████╔╝██║ ╚████║███████╗██║  ██║██║  ██║',
    '╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝'
  ];

  /* ----------------------------------------------------------
   * HEADER
   * ---------------------------------------------------------- */

  console.log('');

  console.log(border(top));

  line();
  line();

  /*
   * Logo à esquerda e nome à direita.
   * O preenchimento é calculado pela largura real do ASCII.
   */

  const logoWidth = 25;

  const titleRows = [
    '',
    ...title,
    '',
    gradient('—  T A S K   F L O W  —', C.cyan, C.violet),
    '',
    fg256(C.muted) + 'AUTOMATE  •  SCHEDULE  •  EXECUTE' + RST,
    fg256(C.gray) + 'MONITOR   •  LOG       •  REPEAT' + RST,
    '',
    fg256(C.green) + '● ' + RST +
      fg256(C.white) + 'MULTI-RUNTIME SCHEDULER' + RST
  ];

  const rows = Math.max(logo.length, titleRows.length);

  for (let i = 0; i < rows; i++) {

    const rawLogo = logo[i] || '';

    const coloredLogo = gradient(
      rawLogo,
      C.cyan,
      C.deep,
      { skipChars: [' '] }
    );

    const logoPadding = ' '.repeat(
      Math.max(0, logoWidth - visibleLength(rawLogo))
    );

    let right = titleRows[i] || '';

    if (i >= 1 && i <= title.length) {
      right = gradient(
        title[i - 1],
        C.ice,
        C.blue,
        { skipChars: [' '] }
      );
    }

    line(
      coloredLogo +
      logoPadding +
      '  ' +
      right,
      3
    );
  }

  line();
  line();

  /* ----------------------------------------------------------
   * FEATURES
   * ---------------------------------------------------------- */

  centered(
    gradient(
      '◆  SCHEDULE    ◆  RUN    ◆  MONITOR    ◆  LOGS    ◆  API',
      C.cyan,
      C.blue,
      { skipChars: [' '] }
    )
  );

  line();

  centered(
    fg256(C.muted) +
    'JavaScript  •  PHP  •  PowerShell  •  Batch  •  Shell' +
    RST
  );

  centered(
    fg256(C.gray) +
    'Node.js >= 20   |   PostgreSQL   |   Windows / Linux' +
    RST
  );

  line();

  console.log(border(separator));

  /* ----------------------------------------------------------
   * STATUS PANEL
   * ---------------------------------------------------------- */

  line();

  line(
    BLD +
    fg256(C.white) +
    'MUNERA TASK FLOW' +
    RST +
    '  ' +
    fg256(C.aqua) +
    'v1.0.0' +
    RST,
    4
  );

  line();

  const statusRows = [
    [
      '◈',
      'PROCESS',
      String(process.pid),
      C.cyan
    ],
    [
      '◷',
      'TIMEZONE',
      cfg.timezone,
      C.ice
    ],
    [
      '↗',
      'API',
      `http://${cfg.host}:${cfg.port}`,
      C.blue
    ],
    [
      '◉',
      'SCHEDULER',
      'ACTIVE',
      C.green
    ],
    [
      '≋',
      'DATABASE',
      'PostgreSQL',
      C.aqua
    ],
    [
      '◈',
      'DEV BY',
      'Victor Beserra',
      C.aqua
    ]
  ];

  for (const [icon, label, value, color] of statusRows) {

    const content =
      fg256(color) +
      icon +
      RST +
      '  ' +
      fg256(C.gray) +
      label.padEnd(12) +
      RST +
      fg256(C.white) +
      value +
      RST;

    line(content, 4);
  }

  line();

  console.log(border(separator));

  /* ----------------------------------------------------------
   * FOOTER
   * ---------------------------------------------------------- */

  line();

  centered(
    fg256(C.green) +
    '● ' +
    RST +
    BLD +
    fg256(C.white) +
    'MUNERA IS READY' +
    RST
  );

  line();

  centered(
    fg256(C.gray) +
    'Waiting for scheduled tasks...' +
    RST
  );

  line();

  centered(
    DIM +
    ITL +
    'Press Ctrl+C to shut down gracefully' +
    RST
  );

  line();

  console.log(border(bottom));

  console.log('');
}

const HELP = `
Munera v3 — Node.js + PostgreSQL + API + SSE
  munera start
  munera add ./scripts/a.js "03:00,15:00"
  munera ./scripts/a.php "04:00"                 (atalho para add)
  munera list | status
  munera run <id> | cancel <id>
  munera pause <id> | resume <id>
  munera time <id> "03:00,15:00"
  munera remove <id>
  munera executions [id]
  munera log <executionId>
  munera events
  munera --help

Scripts permitidos: .js .mjs .cjs .php .ps1 .sh .bat .cmd (bat/cmd somente Windows).
Apenas scripts dentro de SCRIPT_ROOTS podem ser cadastrados.
`;
const args = process.argv.slice(2);
function requireId(s) { if (!/^\d+$/.test(String(s || ''))) throw new Error('ID numérico obrigatório'); return s; }
async function api(method, route, data) {
  const response = await fetch(`http://${cfg.host}:${cfg.port}${route}`, {
    method, headers: { Authorization: `Bearer ${cfg.token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}), signal: AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error}`);
  return result;
}
async function serveWithRestart() {
  let server;
  let closing = false;
  let serveAttempt = 0;

  const stop = async (signal) => {
    if (closing) return;
    closing = true;
    log(`Encerrando por ${signal}...`);
    await stopScheduler().catch(e => log(e.message, 'ERROR'));
    await shutdownRuns();
    try { server?.close(); } catch {}
    try { await pool.end(); } catch {}
    process.exit(0);
  };

  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));

  let bannerPrinted = false;
  while (!closing) {
    serveAttempt++;
    try {
      if (!bannerPrinted) {
        printMuneraBanner();
        bannerPrinted = true;
      }
      log(`[BOOT] inicializando serviço (tentativa ${serveAttempt})...`, serveAttempt === 1 ? 'INFO' : 'WARN');
      await pool.query('SELECT 1 FROM munera.jobs LIMIT 1');
      await startScheduler();
      server = createApi();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(cfg.port, cfg.host, resolve);
      });
      serveAttempt = 0;
      log(`MUNERA V3 ONLINE | PID=${process.pid} | API=http://${cfg.host}:${cfg.port} | TZ=${cfg.timezone}`);
      await new Promise((resolve) => {
        server.once('close', resolve);
      });
    } catch (e) {
      log(`[SERVIÇO] falha ou queda: ${e.stack || e.message}`, 'ERROR');
      try { await stopScheduler().catch(() => {}); } catch {}
      try { server?.close(); } catch {}
      server = null;
      if (closing) break;
      const wait = Math.min(30000, 3000 * Math.max(1, serveAttempt));
      log(`[SERVIÇO] aguardando ${wait}ms para reinicializar (tentativa ${serveAttempt})...`, 'WARN');
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function serve() {
  return serveWithRestart();
}
async function main() {
  if (!args.length || args[0] === '--help' || args[0] === '-h') { console.log(HELP); return; }
  validateConfig();
  const [cmd, ...rest] = args;
  if (cmd === 'start') return serve();
  if (cmd === 'events') {
    const res = await fetch(`http://${cfg.host}:${cfg.port}/events`, { headers: { Authorization: `Bearer ${cfg.token}` } });
    if (!res.ok) throw new Error(`SSE HTTP ${res.status}`);
    for await (const chunk of res.body) process.stdout.write(Buffer.from(chunk));
    return;
  }
  let result;
  if (cmd === 'status') result = await api('GET', '/health');
  else if (cmd === 'list') result = await api('GET', '/jobs');
  else if (cmd === 'add' || /\.(js|mjs|cjs|php|ps1|sh|bat|cmd)$/i.test(cmd)) {
    const script = cmd === 'add' ? rest[0] : cmd;
    const schedule = cmd === 'add' ? rest[1] : rest[0];
    if (!script || !schedule) throw new Error('Uso: munera add ./scripts/a.js "03:00,15:00"');
    result = await api('POST', '/jobs', { script: path.resolve(script), times: schedule });
  } else if (cmd === 'run' || cmd === 'cancel') result = await api('POST', `/jobs/${requireId(rest[0])}/${cmd}`);
  else if (cmd === 'pause' || cmd === 'resume') result = await api('PATCH', `/jobs/${requireId(rest[0])}`, { enabled: cmd === 'resume' });
  else if (cmd === 'time') result = await api('PATCH', `/jobs/${requireId(rest[0])}`, { times: rest[1] });
  else if (cmd === 'remove') result = await api('DELETE', `/jobs/${requireId(rest[0])}`);
  else if (cmd === 'executions') result = await api('GET', `/executions${rest[0] ? `?job_id=${requireId(rest[0])}` : ''}`);
  else if (cmd === 'log') {
    const id = requireId(rest[0]);
    const response = await fetch(`http://${cfg.host}:${cfg.port}/executions/${id}/log`, { headers: { Authorization: `Bearer ${cfg.token}` } });
    console.log(await response.text()); return;
  } else throw new Error(`Comando desconhecido: ${cmd}. Use munera --help`);
  console.log(JSON.stringify(result, null, 2));
}
main().catch(e => { console.error(`[MUNERA ERRO] ${e.stack || e.message}`); process.exitCode = 1; });
