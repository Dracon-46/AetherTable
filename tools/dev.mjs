#!/usr/bin/env node
/**
 * dev.mjs — sobe o ambiente de desenvolvimento e garante que Ctrl+C derruba tudo.
 *
 * POR QUE ESTE WRAPPER EXISTE
 *
 * `turbo run dev` sozinho não fecha o ciclo de vida no Windows: o motivo longo
 * está no cabeçalho de kill-dev.mjs. O resumo é que Ctrl+C mata o turbo e deixa
 * os netos — nest, tsx, os workers do next — segurando as portas.
 *
 * Aqui o encerramento é feito em duas etapas, porque cada uma pega o que a
 * outra perde:
 *   1. `taskkill /T` na árvore do turbo, que segue os filhos ainda ligados a ele;
 *   2. varredura das portas de dev, que pega o neto já reparentado — justamente
 *      o que o /T não enxerga mais.
 *
 * A limpeza roda em qualquer saída: Ctrl+C, Ctrl+Break, fechamento da janela,
 * o turbo morrendo sozinho ou uma exceção aqui dentro.
 *
 * Uso:
 *   pnpm dev                   sobe tudo
 *   pnpm dev -- --filter=web   argumentos extras vão direto para o turbo
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import { alive, killDevProcesses, killTree } from './kill-dev.mjs';

const require = createRequire(import.meta.url);

/** O bin do turbo é um .js — chamar pelo node evita o cmd.exe que o
 *  `turbo.CMD` interporia, e com ele mais um elo para o sinal se perder. */
const TURBO = require.resolve('turbo/bin/turbo');

/** Quanto esperar o turbo sair sozinho antes de forçar. Serve para ele
 *  restaurar o terminal — a TUI usa buffer alternativo e matar no meio
 *  deixaria o prompt sujo. */
const GRACE_MS = 2_000;

// Uma subida limpa começa com a anterior enterrada. Sem isto, um Ctrl+C mal
// resolvido de ontem viraria EADDRINUSE hoje.
killDevProcesses({ quiet: true });

const child = spawn(process.execPath, [TURBO, 'run', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
});

let cleaning = false;

function cleanup({ grace = 0 } = {}) {
  if (cleaning) return;
  cleaning = true;

  // Enquanto o turbo vive ele reergue o que morre, então ele vai primeiro.
  if (child.pid) {
    const deadline = Date.now() + grace;
    while (Date.now() < deadline && alive(child.pid)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    if (alive(child.pid)) killTree(child.pid);
  }

  killDevProcesses({ quiet: true, skip: [process.pid] });
}

// SIGBREAK é o Ctrl+Break do Windows; SIGHUP chega quando a janela do console
// fecha — dá uma janela curta, mas suficiente para a varredura.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  process.on(signal, () => {
    cleanup({ grace: GRACE_MS });
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

// Rede de segurança: cobre saída por exceção e o caminho de process.exit().
process.on('exit', () => cleanup());

child.on('error', (error) => {
  console.error(`Não foi possível iniciar o turbo: ${error.message}`);
  cleanup();
  process.exit(1);
});

child.on('exit', (code, signal) => {
  cleanup();
  process.exit(code ?? (signal ? 1 : 0));
});
