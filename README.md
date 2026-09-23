# Munera Task Flow v3

Agendador multi-runtime · Node.js ≥ 20 · PostgreSQL · CLI + API HTTP + SSE

> Um **único daemon** (processo persistente) gerencia vários agendamentos diários. Scripts rodam em **processos filhos separados** (Node, PHP, PowerShell, Bash, Batch) e todo ciclo de vida é persistido em PostgreSQL. Segundo `munera start` no mesmo banco **não sobe** (advisory lock). Comandos como `add`, `run`, `list` etc. falam via HTTP com a API do serviço já ativo.

---

## 🚀 Quick Start (3 passos)

**Pré-requisitos:** Node.js ≥ 20 instalado; PostgreSQL acessível com banco e schema `munera.*` já criados (veja [Preparar PostgreSQL](#preparar-postgresql)).

```bash
# 1. Instalar dependências
cd munera-task-flow
npm install
Copy-Item .env.example .env      # PowerShell; Linux: cp .env.example .env
```

Edite `.env` e preencha **pelo menos** `API_TOKEN` + credenciais `PG*`.
Para gerar um token forte: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

```bash
# 2. Tornar CLI disponível globalmente
npm link

# 3. Iniciar o serviço (mantém esse terminal aberto)
munera start
```

Em **outro terminal**, já pode operar:

```bash
munera status
munera add ./scripts/exemplo.js "11:30,23:30"
munera list
munera run 1
munera executions 1
munera log 1     # ← ID da EXECUÇÃO (última coluna do comando anterior)
munera events    # ← eventos ao vivo, Ctrl+C para sair
```

---

## Sumário

1. [Preparar PostgreSQL](#preparar-postgresql)
2. [Instalação completa](#instalação-completa)
3. [Arquivo .env — referência](#arquivo-env--referência)
4. [Comandos CLI — referência](#comandos-cli--referência)
5. [Runtimes suportados](#runtimes-suportados)
6. [Scripts de exemplo](#scripts-de-exemplo)
7. [Como funciona o agendamento](#como-funciona-o-agendamento)
8. [API HTTP (para painéis / integrações)](#api-http-para-painéis--integrações)
9. [SSE — Eventos em tempo real](#sse--eventos-em-tempo-real)
10. [Arquitetura interna & Confiabilidade](#arquitetura-interna--confiabilidade)
11. [Casos de uso comuns](#casos-de-uso-comuns)
12. [Troubleshooting](#troubleshooting)
13. [Manutenção e operações](#manutenção-e-operações)

---

## Preparar PostgreSQL

O Munera **não cria** banco/schema automaticamente. Rode como superusuário (ex: `postgres`):

```sql
-- 1. Usuário e banco (uma vez só)
CREATE ROLE munera_app LOGIN PASSWORD 'SENHA_FORTE_AQUI';
CREATE DATABASE muneradb OWNER munera_app;

-- 2. No banco muneradb, aplique o schema
\c muneradb
\i sql/001_init.sql

-- 3. Se o schema foi criado por outro user (ex: postgres), aplique permissões:
GRANT USAGE ON SCHEMA munera TO munera_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA munera TO munera_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA munera TO munera_app;
```

O `sql/001_init.sql` cria 4 tabelas no schema `munera`:

| Tabela | Finalidade |
|---|---|
| `munera.jobs` | Cadastro dos jobs (script, horários, enabled, args/env, timeout) |
| `munera.job_schedules` | Um registro por `HH:mm` de cada job (contém `next_run_at`) |
| `munera.executions` | Um registro por execução (status, pid, exit_code, log_path) |
| `munera.audit` | Log de ações via API (`job.upsert`, `job.run` etc.) |

---

## Instalação completa

```bash
cd munera-task-flow
npm install
Copy-Item .env.example .env            # PowerShell
# Linux/macOS: cp .env.example .env

# Edite .env com PG* e API_TOKEN
code .env                               # ou notepad / nano / vi

npm link                                # expõe o comando "munera" globalmente
munera start                            # sobe o serviço
```

### Rodar como serviço do SO (opcional, recomendado para produção)

- **Linux (systemd):** crie `/etc/systemd/system/munera.service` com `WorkingDirectory=`, `ExecStart=npm start` apontando para o diretório, depois `systemctl daemon-reload && systemctl enable --now munera`.
- **Windows:** use o Gerenciador de Tarefas → Aplicativos Iniciados, ou `nssm`/`WinSW` para registrar como serviço Windows apontando para `node index.js start`.

---

## Arquivo .env — referência

| Variável | Padrão | Obriga? | Descrição |
|---|---|---|---|
| `TZ` | `America/Sao_Paulo` | Não | Fuso usado no cálculo dos `HH:mm` |
| `API_HOST` | `127.0.0.1` | Não | Bind da API (não exponha em 0.0.0.0 sem VPN/reverso) |
| `API_PORT` | `47831` | Não | Porta HTTP da API |
| `API_TOKEN` | — | **Sim** | Token ≥ 32 chars (Bearer); todos os endpoints exigem |
| `CORS_ORIGINS` | vazio | Não | Lista separada por vírgula (ex: painel em outra origem) |
| `PGHOST` | `127.0.0.1` | Não | Host do PostgreSQL |
| `PGPORT` | `5432` | Não | Porta |
| `PGDATABASE` | `muneradb` | Não | Banco |
| `PGUSER` | `munera_app` | Não | Usuário |
| `PGPASSWORD` | — | **Sim** | Senha |
| `PGSSLMODE` | — | Não | `require` ativa SSL; default desativado |
| `PGPOOL_MAX` | `10` | Não | Máx. conexões no pool interno |
| `LOG_DIR` | `./src/log` | Não | Diretório dos logs de execução |
| `SCRIPT_ROOTS` | `./scripts` | Não | Diretórios permitidos para scripts (separador `;` no Windows) |
| `SCHEDULER_POLL_MS` | `1000` | Não | Frequência do loop de checagem (250 a 60000) |
| `DEFAULT_TIMEOUT_SECONDS` | `3600` | Não | Timeout por job quando não informado |
| `MAX_CONCURRENT` | `4` | Não | Limite global de execuções simultâneas |
| `LOG_MAX_BYTES` | `104857600` (100 MB) | Não | Tamanho máximo do ARQUIVO de log por execução |
| `NODE_BIN` | `node` | Não | Caminho do interpretador Node |
| `PHP_BIN` | `php` | Não | Caminho do PHP CLI |
| `BASH_BIN` | `bash` | Não | Caminho do Bash |
| `POWERSHELL_BIN` | `pwsh` | Não | Windows PS 5.1 use `powershell.exe` |
| `CMD_BIN` | `cmd.exe` | Não | Interpretador .bat/.cmd (Windows) |

---

## Comandos CLI — referência

Todos os comandos (exceto `start` e `--help`) exigem que o serviço já esteja rodando em `munera start`.

| Comando | Descrição |
|---|---|
| `munera start` | Inicia API + scheduler (1 por banco via `pg_try_advisory_lock`) |
| `munera status` / `munera list` | Healthcheck (status) ou lista de jobs (list) |
| `munera ./scripts/a.js "03:00,15:00"` | **Atalho** para `munera add ./scripts/a.js "03:00,15:00"` |
| `munera add <script> "HH:mm,HH:mm,..."` | Cria job novo OU acrescenta horários em script existente |
| `munera run <id>` | Solicita execução manual imediata (respeita `MAX_CONCURRENT`) |
| `munera cancel <id>` | Cancela execução ativa (mata a árvore de processos) |
| `munera pause <id>` | Desabilita próximos disparos (não interrompe execução atual) |
| `munera resume <id>` | Reabilita agendamento |
| `munera time <id> "06:00,18:00"` | **Substitui** todos os horários do job |
| `munera remove <id>` | Remove job; histórico `executions.job_id` vira NULL |
| `munera executions [id]` | Últimas execuções (globais ou do job) |
| `munera log <executionId>` | Imprime o log de uma execução específica |
| `munera events` | Stream SSE ao vivo; use `Ctrl+C` para sair |
| `munera --help` | Ajuda embutida |

### Diferença importante: `add` × `time`
- `munera add ./a.js "06:00"` — se `./a.js` já existe, **adiciona** o horário 06:00 aos existentes.
- `munera time <id> "06:00"` — **apaga** todos os horários do job `<id>` e deixa **apenas** 06:00.

Para rodar o mesmo arquivo com configurações diferentes, crie scripts wrapper (ex: `a-manha.js` e `a-noite.js`), pois `script_path` é único.

---

## Runtimes suportados

| Extensão | Execução (via env var) | Observações |
|---|---|---|
| `.js` `.mjs` `.cjs` | `$NODE_BIN script` | Node CLI padrão |
| `.php` | `$PHP_BIN script` | No XAMPP/Windows use `PHP_BIN=C:\xampp\php\php.exe` |
| `.ps1` | `$POWERSHELL_BIN -NoProfile -NonInteractive -File script ...args` | Win 10/11 padrão use `POWERSHELL_BIN=powershell.exe` |
| `.sh` | `$BASH_BIN script` | Windows exige Bash instalado (Git Bash, WSL) |
| `.bat` `.cmd` | `$CMD_BIN /d /s /c ""script""` | **Somente Windows**; **NÃO** aceita argumentos por segurança |

Os scripts herdam `process.env` do daemon + `env` específico do job (campo `env` da API).
Caminhos de script são resolvidos para caminho absoluto e validados contra `SCRIPT_ROOTS` (mesmo após resolver symlinks) para evitar fuga de diretório.

---

## Scripts de exemplo

A pasta `scripts/` já vem com exemplos. Você pode executá-los manualmente para testar:

```javascript
// scripts/exemplo.js
console.log('[exemplo stdout] Ola do Node.js!');
console.error('[exemplo stderr] nada de errado, so stderr exemplo');
process.exit(0);
```

```php
<?php
// scripts/exemplo.php
echo "[exemplo php] Rodando em " . date('c') . PHP_EOL;
```

```powershell
# scripts/exemplo.ps1
Write-Output "[exemplo pwsh] $env:COMPUTERNAME $(Get-Date -Format s)"
```

```bash
#!/usr/bin/env bash
# scripts/exemplo.sh
echo "[exemplo sh] Host: $HOSTNAME Date: $(date -Iseconds)"
```

```batch
@echo off
REM scripts/exemplo.bat
echo [exemplo bat] Ola do Windows CMD! Date: %date% %time%
```

### Como testar

```bash
munera add ./scripts/exemplo.bat "08:00,20:00"
munera run 1                 # executa imediatamente (não espera o horário)
munera log 1                 # veja a saida
```

---

## Como funciona o agendamento

- **Tick loop:** a cada `SCHEDULER_POLL_MS` (padrão 1 s), o scheduler consulta `munera.job_schedules` com `next_run_at <= now()` e processa até 100 jobs pendentes.
- **Sem catch-up:** disparos vencidos há **mais de 60 s** enquanto o daemon estava fora são pulados (log WARN: "Horário perdido"). Sem replay de dias ausentes.
- **Sem sobreposição por job:** mesmo `id` não executa em paralelo; horário coincidente vira `skipped` com motivo `already_running_or_capacity`.
- **Limite global:** `MAX_CONCURRENT` execuções simultâneas; acima disso, novos disparos são `skipped`.
- **Avança `next_run_at` ANTES de spawnar:** evita reentrega caso o scheduler trave. A próxima execução é imediatamente o próximo dia útil (`nextAt`).
- **Timezone:** `TZ` do `.env` é aplicado no processo Node; cálculo do `HH:mm` considera o horário local do fuso configurado.

---

## API HTTP (para painéis / integrações)

Base: `http://127.0.0.1:47831`
Todas as rotas exigem header:

```
Authorization: Bearer <API_TOKEN do .env>
```

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Status + PID + qtde rodando + fuso |
| `GET` | `/jobs` | Lista jobs + schedules + último status |
| `POST` | `/jobs` | Cria ou mescla job (mesmo `script` existente). Body: `{ script, times, name?, args?, env?, timeout_seconds? }` |
| `GET` | `/jobs/:id` | Detalhe do job |
| `PATCH` | `/jobs/:id` | Atualiza campos: `name`, `times`, `enabled`, `args`, `env`, `timeout_seconds` |
| `DELETE` | `/jobs/:id` | Remove (HTTP 409 se houver execução ativa) |
| `POST` | `/jobs/:id/run` | Dispara execução manual (HTTP 202 Accepted) |
| `POST` | `/jobs/:id/cancel` | Cancela execução ativa |
| `GET` | `/executions?job_id=&limit=30` | Histórico, limit a 100 |
| `GET` | `/executions/:id/log?tail_bytes=16384` | Final do arquivo log em texto |
| `GET` | `/events` | SSE de eventos ao vivo |

### Exemplo `POST /jobs`

```json
{
  "name": "Delta DATASUS",
  "script": "/opt/munera/scripts/delta.js",
  "times": ["03:00", "15:00"],
  "args": ["--limit", "1000"],
  "env": { "AMBIENTE": "homolog" },
  "timeout_seconds": 7200
}
```

### Exemplo com curl / PowerShell

```bash
# Linux / Bash
curl -sH "Authorization: Bearer $API_TOKEN" http://127.0.0.1:47831/jobs
```

```powershell
# PowerShell
$headers = @{ Authorization = "Bearer $env:API_TOKEN" }
Invoke-RestMethod http://127.0.0.1:47831/jobs -Headers $headers
```

---

## SSE — Eventos em tempo real

Rota: `GET /events` (text/event-stream).
Eventos emitidos: `ready`, `job.changed`, `job.deleted`, `execution.started`, `execution.output`, `execution.finished`, `execution.skipped`, `execution.cancel_requested`, `execution.error`.

> `EventSource` nativo do navegador não aceita headers customizados. **Autentique pelo backend do seu painel** que faz proxy do SSE (recomendado) ou use `fetch` + stream manual:

```js
const res = await fetch('http://127.0.0.1:47831/events', {
  headers: { Authorization: 'Bearer TOKEN_AQUI' }
});
const reader = res.body.getReader();
const dec = new TextDecoder();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  console.log(dec.decode(value, { stream: true }));
}
```

- `execution.output` contém apenas os **primeiros 8192 bytes** de cada chunk para não sobrecarregar SSE. Busque `/executions/:id/log` para recuperação completa.
- Não há replay de eventos perdidos após reconexão; refaça `GET /jobs` e `GET /executions` para reconstruir o estado.

---

## Arquitetura interna & Confiabilidade

```
                  ┌───────────────────────────────────────────────┐
                  │              munera start (daemon)            │
                  │                                               │
  HTTPS/CLI ─────►│  API HTTP (Bearer)     ┌─────────────────┐  │
                  │  createApi()           │ Scheduler tick  │  │
                  │                        │ pg advisory LOCK│  │
                  │  runner.js             │ (único dono)    │  │
                  │  spawn() filhos        └──────┬──────────┘  │
                  │  .js/.php/.ps1/.sh/.bat       │             │
                  └──────┬────────────────────────┘             │
                         │  pool pg (keepAlive + retry 3×)       │
                         ▼                                        │
                  PostgreSQL / PgBouncer (schema munera.*)         │
                  └───────────────────────────────────────────────┘
```

### Reconexão automática PostgreSQL (a partir da v3 atual)

Motivo comum de queda em ambientes corporativos: `PgBouncer`/proxy com `client_idle_limit` baixo (erro código **57000**). Tratamentos:

- `pg.Pool` configurado com `keepAlive: true` + `keepAliveInitialDelayMillis`.
- Todo `Client` retirado do pool (inclusive o do `advisory lock` do scheduler) ganha listener de `'error'` e `'end'` → **nunca mais erro unhandled mata o processo**.
- `query()` usa retry exponencial de 3 tentativas para erros transitórios (57000, 08xxx, ECONNRESET, timeout, idle_limit etc.).
- Scheduler: `lockClient` caindo → aguarda 2 s → readquire `pg_try_advisory_lock` e retoma o tick automaticamente.
- `serve()` do CLI tem loop externo: se o serviço/sub-sistema cair, reinicializa tudo com backoff (cap 30 s).
- Handlers globais `uncaughtException` / `unhandledRejection` logam sem crashar.

### Outras garantias / limitações conhecidas

- **1 daemon por banco:** o segundo `munera start` falha ("Já existe outro Munera ativo").
- **Queda do daemon:** execuções `running` viram `interrupted` no próximo start. Processos filhos órfãos devem ser evitados com serviço do SO que mata a árvore (systemd KillMode / taskkill /T).
- **Logs de execução:** arquivos em `LOG_DIR/<nome>-<id>/log-YYYYMMDDTHH-MM-SS-<pid>.txt`; configure rotação externa se necessário.
- **Segredos no `env`:** pessoas com acesso de leitura ao PostgreSQL conseguem ler; para credenciais sensíveis use variáveis do serviço do SO ou sistema de secrets.
- **V3 não é fila transacional:** em crash raro entre `UPDATE next_run_at` e `INSERT executions`, aquele disparo pode ser perdido. Para garantia forte, evolua com outbox pattern (na mesma transação).

---

## Casos de uso comuns

### 1) Integração DATASUS / CNES diária (03:00)
```bash
# Job Node (baixar + persistir)
munera add ./jobs/cnes-delta.js "03:00"
# Job PHP (converter / carga)
munera add ./jobs/load-cnes.php "03:30"
# Checar manualmente
munera run 1 ; sleep 5 ; munera log 1
```

### 2) Limpeza de cache PHP a cada 6h
```powershell
# PowerShell script (Remove-Item em C:\xampp\htdocs\cache\*)
# schedules: 00:00 06:00 12:00 18:00
munera time 3 "00:00,06:00,12:00,18:00"
# Via API altera também o timeout para 10 minutos
PATCH /jobs/3  {"timeout_seconds": 600}
```

### 3) Relatório BI semanal (segundas 07:00)
O Munera só dispara **diariamente**. Para "semanal seg 07:00", deixe o script decidir:
```bash
# Shell wrapper que segue se HOJE é segunda-feira (exit 0 faz success)
munera add ./jobs/relatorio-bi.sh "07:00"
```
```bash
#!/usr/bin/env bash
DOW=$(date +%u)   # 1=segunda
if [ "$DOW" != "1" ]; then
  echo "Nao e segunda, saindo"; exit 0
fi
./gera-relatorio.sh
```

---

## Troubleshooting

### Diagnóstico rápido
```bash
node --version          # mínimo 20
npm run check           # syntax check em todos os src/*.js
munera status           # API + DB respondem?
munera list             # jobs carregados?
```

### Erros frequentes

- **`relation "munera.jobs" does not exist`** → schema não foi criado no banco `PGDATABASE`. Rode `sql/001_init.sql`.
- **`permission denied for schema munera`** → falta `GRANT USAGE ON SCHEMA munera TO munera_app` e grants em tabelas/sequences.
- **`Defina API_TOKEN forte (>=32 caracteres)` ao iniciar** → valor no `.env` é curto ou `COLOQUE_...`. Gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- **`Script fora de SCRIPT_ROOTS`** → mover o script para dentro de um dos diretórios listados em `.env` (`SCRIPT_ROOTS`). Absoluto ou relativo à raiz do projeto.
- **`spawn php ENOENT` (ou `pwsh`, `bash`, `cmd.exe`)** → binário não está no `PATH` do serviço; aponte a variável correspondente no `.env` (ex: `PHP_BIN=C:\xampp\php\php.exe`) e reinicie `munera start`.
- **Já existe outro Munera ativo neste banco (advisory lock)** → esperado. Use `munera status` para confirmar que o primeiro está UP.
- **`Uncaught error: unable to read data · code 57000 · client_idle_limit`** → em versões **antigas** isso crashava; na versão atual é tratado internamente e o serviço se reconecta sozinho (log WARN: `[LOCK] ... reconexão`). Basta manter `munera start` rodando.
- **`Token inválido ou ausente` na API** → confira se `Authorization: Bearer <valor>` bate exatamente com `API_TOKEN` do `.env` do processo em execução.
- **Jobs não disparam no horário** → rode `munera list` e confira `enabled=true` e horários em `HH:mm` com 24h (ex: `03:05`, não `3:5`). Verifique `TZ` no `.env` e data/hora do servidor.
- **Execução fica `running` infinitamente** → `timeout_seconds` padrão é 1h; se não terminar até lá vira `timeout`. Reduza o valor ou use `munera cancel <id>`.

---

## Manutenção e operações

- **Parada graciosa:** `Ctrl+C` no terminal do serviço (SIGINT/SIGTERM) → dispara `stop()`: cancela execuções ativas com motivo `cancelled`, desbloqueia o advisory lock, fecha o pool PG.
- **Atualizar binários do Munera:** `git pull ; npm install ; npm link` e reinicie o serviço. Tabelas do schema são estáveis (backward-compat); migrations futuras ficarão em `sql/` com prefixo numérico.
- **Limpar logs antigos:** arquivos em `LOG_DIR/` nunca são apagados. Rotina recomendada (ex: semanal): `Get-ChildItem $LOG_DIR -Recurse -File | Where LastWriteTime -lt (Get-Date).AddDays(-30) | Remove-Item`.
- **Auditoria:** `select * from munera.audit order by id desc limit 50;` mostra ações do CRUD/API.
- **Checagem de versão / integridade:** `npm run check` (syntax check). Para validação on-line: bater em `/health`.

---

## Estrutura do projeto

```
munera-task-flow/
├── index.js                 # CLI: serve() + comandos via fetch
├── package.json             # "bin": { "munera": "./index.js" }
├── .env.example             # template de configuração
├── sql/001_init.sql         # schema PostgreSQL (tabelas + índices)
├── scripts/                 # scripts de exemplo / jobs reais
│   ├── exemplo.js  exemplo.php  exemplo.ps1  exemplo.sh  exemplo.bat
└── src/
    ├── config.js            # carrega .env, valida, expõe cfg e log()
    ├── db.js                # pool pg, query com retry, transaction, audit, handlers globais
    ├── runtime.js           # valida horários/paths, escolhe interpretador
    ├── runner.js            # spawn filhos, timeout, logs, cancelamento, EventEmitter
    ├── service.js           # CRUD jobs + scheduler com advisory lock + reconexão
    ├── api.js               # servidor HTTP REST + SSE (autenticado Bearer)
    └── log/                 # criado em runtime: <job>-<id>/log-*.txt
```
