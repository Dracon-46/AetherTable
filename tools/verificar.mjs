#!/usr/bin/env node
/**
 * verificar.mjs — a bateria completa, num comando (DOC-092).
 *
 * ─── POR QUE ISTO É UM SCRIPT E NÃO UM `&&` NO package.json ────────────────
 *
 * Três motivos, e nenhum é estético:
 *
 * 1. A ORDEM IMPORTA E PRECISA SER EXPLICADA. `shared-types build` vem antes
 *    de tudo porque o frontend e o game-server importam o pacote pelo `dist`;
 *    sem ele, o typecheck falha por módulo ausente e a mensagem não fala do
 *    problema real. Uma corrente de `&&` não tem onde dizer isso.
 *
 * 2. O RESUMO FINAL. Numa corrente, o primeiro passo que falha corta os
 *    demais e a saída termina no meio do log de uma ferramenta. Aqui a
 *    execução para no primeiro erro — o que é o certo, porque um passo
 *    quebrado invalida os seguintes — mas o que fica na tela é uma tabela do
 *    que passou, o que falhou e como reproduzir só aquele passo.
 *
 * 3. O LEMBRETE DO E2E. A bateria não cobre interação entre jogadores nem
 *    gesto de mouse, e todos os defeitos relatados por jogador passaram por um
 *    `pnpm test` verde. Um comando que termina em "tudo certo" sem mencionar
 *    isso mente por omissão para quem acabou de mexer no `GameBoard`.
 *
 * Uso:
 *   pnpm verificar              a bateria inteira
 *   pnpm verificar --rapido     pula build e format (para o laço de edição)
 */

import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';

const RAPIDO = process.argv.includes('--rapido');

/**
 * Cada passo diz o que ele PEGA, e não o que ele roda — o comando já está ali
 * ao lado. É o mesmo critério dos comentários do resto do repositório.
 */
const PASSOS = [
  {
    nome: 'shared-types',
    comando: ['pnpm', ['--filter', '@aethertable/shared-types', 'build']],
    pega: 'O frontend e o game-server importam o pacote pelo `dist`. Sem isto, tudo abaixo falha por módulo ausente.',
  },
  {
    nome: 'schema:check',
    comando: ['pnpm', ['schema:check']],
    pega: 'Mirror do Colyseus defasado. É o passo mais barato e protege o bug mais caro: campo fora de ordem corrompe o state sem emitir erro.',
  },
  {
    nome: 'docs:estado',
    comando: ['pnpm', ['docs:estado']],
    pega: 'Intenção que o cliente emite e o servidor não conhece — descartada em silêncio pelo Colyseus.',
  },
  {
    nome: 'lint',
    comando: ['pnpm', ['lint']],
    pega: 'Hook condicional (já derrubou a mesa) e `Math.random()` fora de services/rng.ts (RN06).',
  },
  {
    nome: 'typecheck',
    comando: ['pnpm', ['typecheck']],
    pega: 'O contrato entre os três apps.',
  },
  {
    nome: 'test',
    comando: ['pnpm', ['test']],
    pega: 'Unidade e contrato.',
  },
  {
    nome: 'build',
    comando: ['pnpm', ['build']],
    pega: 'O que o tsc não pega — `useSearchParams` sem Suspense já quebrou o build com typecheck verde.',
    pularNoRapido: true,
  },
  {
    nome: 'format:check',
    comando: ['pnpm', ['format:check']],
    pega: 'Diff de formatação some no meio de diff de conteúdo.',
    pularNoRapido: true,
  },
];

/**
 * Caminhos cuja alteração exige o E2E de mesa antes de subir.
 *
 * São os arquivos em que um defeito NÃO aparece em teste de unidade: render,
 * geometria e o caminho de conexão. Ver DOC-092 §2.
 */
const EXIGEM_E2E = [
  'apps/frontend/src/canvas/',
  'apps/frontend/src/net/useRoomSync',
  'apps/frontend/src/app/play/',
  'apps/game-server/src/rooms/AetherRoom',
];

/** Roda um git e devolve a saída, ou '' se ele falhar. */
function git(...args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    // Um `git diff` contra uma ref que não existe (repositório recém-clonado,
    // sem `origin/main`) não é erro deste script — é ausência de informação.
    return '';
  }
}

/**
 * Arquivos tocados: os do worktree mais os que esta branch tem a mais que a
 * `main`. `null` quando não há git nenhum.
 */
function arquivosTocados() {
  const naArvore = git('diff', '--name-only', 'HEAD');
  const naBranch = git('diff', '--name-only', 'main...HEAD');
  const tudo = `${naArvore}\n${naBranch}`.split('\n').filter(Boolean);

  // Sem git, sem resposta — e aí o lembrete do E2E passa a ser incondicional.
  // Errar para o lado de lembrar demais.
  if (!git('rev-parse', '--git-dir').trim()) return null;
  return tudo;
}

const t0 = Date.now();
const resultados = [];

for (const passo of PASSOS) {
  if (RAPIDO && passo.pularNoRapido) {
    resultados.push({ ...passo, estado: 'pulado' });
    continue;
  }

  process.stdout.write(`\n\x1b[1m▸ ${passo.nome}\x1b[0m\n`);
  const [cmd, args] = passo.comando;
  // `shell: true` no Windows: `pnpm` é um .cmd, e o spawn sem shell não o acha.
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });

  if (r.status !== 0) {
    resultados.push({ ...passo, estado: 'falhou' });
    imprimirResumo(resultados, passo);
    process.exit(1);
  }
  resultados.push({ ...passo, estado: 'ok' });
}

imprimirResumo(resultados, null);

function imprimirResumo(resultados, falhou) {
  const seg = ((Date.now() - t0) / 1000).toFixed(1);
  const linha = '─'.repeat(64);

  console.log(`\n${linha}`);
  for (const r of resultados) {
    const marca =
      r.estado === 'ok'
        ? '\x1b[32m✓\x1b[0m'
        : r.estado === 'falhou'
          ? '\x1b[31m✗\x1b[0m'
          : '\x1b[90m–\x1b[0m';
    console.log(`${marca} ${r.nome}`);
  }
  console.log(linha);

  if (falhou) {
    console.log(`\n\x1b[31mA verificação parou em "${falhou.nome}".\x1b[0m`);
    console.log(`\nO que este passo pega:\n  ${falhou.pega}`);
    console.log(`\nPara rodar só ele:\n  ${falhou.comando[0]} ${falhou.comando[1].join(' ')}\n`);
    return;
  }

  console.log(`\n\x1b[32mTudo verde em ${seg}s.\x1b[0m`);
  if (RAPIDO) {
    console.log('\x1b[33mModo rápido: `build` e `format:check` NÃO rodaram.\x1b[0m');
  }

  /**
   * O LEMBRETE QUE FAZ ESTE SCRIPT VALER A PENA.
   *
   * A bateria acima não enxerga interação entre jogadores nem gesto de mouse.
   * O botão direito que comprava carta, a câmera que não trocava de mesa, o
   * mulligan no meio da partida — todos passaram por um `pnpm test` verde.
   */
  const tocados = arquivosTocados();
  const mexeuNaMesa =
    tocados === null || tocados.some((f) => EXIGEM_E2E.some((p) => f.startsWith(p)));

  if (mexeuNaMesa) {
    console.log(
      [
        '',
        '\x1b[33m─── FALTA O E2E DE MESA ───────────────────────────────────\x1b[0m',
        '',
        'Você tocou no render ou no caminho de conexão da mesa, e nada acima',
        'enxerga interação entre jogadores. Antes de subir (DOC-092 §2):',
        '',
        '  pnpm dev',
        '  node apps/frontend/e2e/fixtures/preparar-jogadores.mjs',
        '  cd apps/frontend',
        '  E2E_BASE_URL=http://localhost:3030 npx playwright test --project=desktop',
        '',
      ].join('\n'),
    );
  }
}
