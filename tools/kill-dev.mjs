#!/usr/bin/env node
/**
 * kill-dev.mjs — derruba tudo que o ambiente de desenvolvimento deixa para trás.
 *
 * POR QUE ESTA FERRAMENTA EXISTE
 *
 * O Windows não tem process group. Ao apertar Ctrl+C o console entrega
 * CTRL_C_EVENT ao turbo, mas os NETOS sobrevivem: o node que o
 * `nest start --watch` reexecuta a cada save, o filho do `tsx watch` e os
 * workers do `next dev` não estão presos ao pai por nada que o sinal alcance.
 * Eles continuam segurando 3030/3333/2567 depois que o terminal já voltou ao
 * prompt.
 *
 * O sintoma não é óbvio. Na próxima subida o Next escorrega sozinho para 3031,
 * o game-server morre com EADDRINUSE e o frontend passa a conversar com o
 * processo VELHO — código de ontem respondendo por cima do código de hoje.
 *
 * São duas varreduras porque nenhuma sozinha basta:
 *   1. por porta — pega quem está servindo, mesmo sem parentesco conhecido;
 *   2. por linha de comando — pega o watcher que ainda não abriu (ou já fechou)
 *      o socket e segue recompilando em segundo plano.
 *
 * Uso:
 *   node tools/kill-dev.mjs             derruba tudo
 *   node tools/kill-dev.mjs --dry-run   só lista o que morreria
 *   node tools/kill-dev.mjs --quiet     silencioso quando não há nada
 */

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WINDOWS = process.platform === 'win32';

/** Portas de desenvolvimento. Fonte: o `.env.example` de cada app. */
export const DEV_PORTS = [
  { port: 3030, app: 'frontend' },
  { port: 3333, app: 'backend-core' },
  { port: 2567, app: 'game-server' },
];

/**
 * A varredura por linha de comando só mata processo que cite o repositório E
 * uma destas ferramentas. As duas condições juntas são o que impede de levar
 * junto um node do editor, do Claude Code ou de outro projeto.
 */
const DEV_TOOLS = /(turbo|next|nest|tsx|jest|prisma|colyseus)/i;

const normalized = (value) => value.replace(/\\/g, '/').toLowerCase();
const ROOT_KEY = normalized(ROOT);

function run(file, args) {
  try {
    return execFileSync(file, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
  } catch {
    return '';
  }
}

/** Pausa bloqueante: a limpeza roda dentro de handler de sinal e de 'exit',
 *  onde o event loop já não gira e um `await` nunca resolveria. */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function tag(map, pid, label) {
  if (!map.has(pid)) map.set(pid, new Set());
  map.get(pid).add(label);
}

/** true enquanto o processo existe. Sinal 0 não entrega nada, só consulta. */
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** Mata o processo e seus descendentes conhecidos. */
export function killTree(pid) {
  if (IS_WINDOWS) {
    run('taskkill', ['/PID', String(pid), '/T', '/F']);
    return;
  }
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      /* já morreu, ou nunca foi líder de grupo */
    }
  }
}

/** pid -> rótulos, para quem estiver ouvindo nas portas de dev. */
function pidsOnPorts() {
  const wanted = new Map(DEV_PORTS.map(({ port, app }) => [port, app]));
  const hits = new Map();

  if (IS_WINDOWS) {
    // O cabeçalho do netstat é traduzido, os dados não: "LISTENING" sai em
    // inglês mesmo num Windows pt-BR. Ainda assim aceitamos porta remota 0
    // como segundo critério, que é o que de fato define um listener.
    for (const line of run('netstat', ['-a', '-n', '-o', '-p', 'tcp']).split(/\r?\n/)) {
      const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+:(\d+)\s+(\S+)\s+(\d+)\s*$/);
      if (!match) continue;
      const [, localPort, remotePort, state, pid] = match;
      if (remotePort !== '0' && state.toUpperCase() !== 'LISTENING') continue;
      const app = wanted.get(Number(localPort));
      if (app) tag(hits, Number(pid), `porta ${localPort} (${app})`);
    }
    return hits;
  }

  for (const { port, app } of DEV_PORTS) {
    const out = run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t']);
    for (const pid of out.split(/\s+/).filter(Boolean)) {
      tag(hits, Number(pid), `porta ${port} (${app})`);
    }
  }
  return hits;
}

/** pid -> rótulos, para watcher deste repositório que não está numa porta. */
function strayProcesses(protectedPids) {
  const hits = new Map();
  const lines = IS_WINDOWS
    ? run('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }",
      ])
    : run('ps', ['-eo', 'pid=,args=']);

  for (const raw of lines.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const separator = IS_WINDOWS ? line.indexOf('|') : line.indexOf(' ');
    if (separator < 0) continue;
    const pid = Number(line.slice(0, separator));
    const command = line.slice(separator + 1).trim();
    if (!Number.isInteger(pid) || pid <= 4 || protectedPids.has(pid)) continue;

    const key = normalized(command);
    // Precisa citar o repo, citar uma ferramenta de dev e não ser do próprio
    // Claude Code — que roda com o cwd aqui dentro, mas nunca com o repo na
    // linha de comando.
    if (!key.includes(ROOT_KEY) || key.includes('/.claude/')) continue;
    if (!DEV_TOOLS.test(key.slice(ROOT_KEY.length))) continue;

    tag(hits, pid, describe(command));
  }
  return hits;
}

/** Encurta a linha de comando para caber numa linha de log. */
function describe(command) {
  const short = command.replace(new RegExp(ROOT.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'), 'gi'), '.');
  return short.length > 90 ? `${short.slice(0, 87)}…` : short;
}

/**
 * Derruba os processos de desenvolvimento deste repositório.
 *
 * @param {object}   [options]
 * @param {boolean}  [options.dryRun=false] lista sem matar
 * @param {boolean}  [options.quiet=false]  não imprime quando não há nada
 * @param {number[]} [options.skip=[]]      pids que nunca devem ser tocados
 * @returns {number} quantos processos foram alvo
 */
export function killDevProcesses({ dryRun = false, quiet = false, skip = [] } = {}) {
  const protectedPids = new Set([process.pid, process.ppid, ...skip].filter(Boolean));
  const targets = new Map();

  for (const [pid, labels] of pidsOnPorts()) {
    if (protectedPids.has(pid) || pid <= 4) continue;
    for (const label of labels) tag(targets, pid, label);
  }
  for (const [pid, labels] of strayProcesses(protectedPids)) {
    for (const label of labels) tag(targets, pid, label);
  }

  if (targets.size === 0) {
    if (!quiet) {
      console.log(`Nada rodando em ${DEV_PORTS.map(({ port }) => port).join(', ')}.`);
    }
    return 0;
  }

  for (const [pid, labels] of targets) {
    console.log(`${dryRun ? '[dry-run]' : 'encerrando'} pid ${pid} — ${[...labels].join(', ')}`);
    if (!dryRun) killTree(pid);
  }
  if (dryRun) return targets.size;

  // taskkill devolve antes de o kernel derrubar o processo. Confirma que as
  // portas realmente ficaram livres em vez de prometer que ficaram.
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const remaining = [...pidsOnPorts().keys()].filter((pid) => !protectedPids.has(pid));
    if (remaining.length === 0) {
      console.log(`Portas ${DEV_PORTS.map(({ port }) => port).join(', ')} livres.`);
      return targets.size;
    }
    sleep(200);
  }
  console.warn(
    'Aviso: alguma porta de dev continua ocupada. Rode `pnpm dev:kill` de novo ou verifique com `netstat -ano | findstr 3030`.',
  );
  return targets.size;
}

const invokedDirectly =
  process.argv[1] &&
  normalized(resolve(process.argv[1])) === normalized(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  killDevProcesses({
    dryRun: process.argv.includes('--dry-run'),
    quiet: process.argv.includes('--quiet'),
  });
}
