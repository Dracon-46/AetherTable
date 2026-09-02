#!/usr/bin/env node
/**
 * sala-de-demonstracao.mjs — senta três jogadores numa mesa e SEGURA a conexão.
 *
 * ─── PARA QUE SERVE ────────────────────────────────────────────────────────
 *
 * Revisar a mesa sozinho não mostra quase nada: metade do que importa (faixas
 * dos oponentes, log da mesa, dano de comandante, pedido de visualização, de
 * quem é a vez) só existe quando há gente do outro lado. Este script abre três
 * navegadores headless, leva os três até a partida começar, e então NÃO SAI —
 * fica segurando os sockets para que uma pessoa possa entrar no quarto assento
 * e ver a mesa cheia.
 *
 * Não é teste: não afirma nada. É andaime de inspeção manual.
 *
 * Uso:
 *   node e2e/sala-de-demonstracao.mjs
 *   (Ctrl+C encerra e os três saem da mesa)
 */

import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const API = process.env.E2E_API_URL ?? 'http://localhost:3333/api/v1';
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3030';
const CHROMIUM = process.env.E2E_CHROMIUM_PATH;

const { senha, jogadores } = JSON.parse(
  readFileSync(join(AQUI, 'fixtures', 'jogadores.json'), 'utf8'),
);

/** Os três que sentam. O quarto assento fica livre para quem for inspecionar. */
const BOTS = jogadores.slice(0, 3);

async function chamar(caminho, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + caminho, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const texto = await res.text();
  try {
    return { status: res.status, dados: JSON.parse(texto) };
  } catch {
    return { status: res.status, dados: { raw: texto } };
  }
}

// ─── Sessões frescas ────────────────────────────────────────────────────────
//
// O access token do `jogadores.json` pode ter envelhecido entre uma execução e
// outra; o passe de assento é de uso único e precisa ser novo SEMPRE.
for (const bot of BOTS) {
  const login = await chamar('/auth/login', {
    method: 'POST',
    body: { email: bot.email, password: senha },
  });
  if (login.status >= 300) throw new Error(`login de ${bot.username} falhou (${login.status})`);
  bot.token = login.dados.accessToken;
  bot.user = login.dados.user;
}

const criada = await chamar('/matches/create', { method: 'POST', token: BOTS[0].token });
const CODIGO = criada.dados.roomCode;

const navegador = await chromium.launch({
  headless: true,
  ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
});

const abertos = [];

async function sentar(bot) {
  // O passe leva o deck junto: assim o bot chega com o grimório provisionado e
  // a inspeção começa numa mesa que já tem cartas.
  const passe = await chamar(`/matches/${CODIGO}/join`, {
    method: 'POST',
    token: bot.token,
    body: { deckId: bot.deckId },
  });
  if (passe.status >= 300) {
    throw new Error(`passe de ${bot.username} falhou (${passe.status})`);
  }

  const ctx = await navegador.newContext({ viewport: { width: 1600, height: 950 } });
  await ctx.addInitScript(
    ([token, user]) => {
      window.localStorage.setItem(
        'aethertable-auth-storage',
        JSON.stringify({ state: { accessToken: token, user }, version: 0 }),
      );
    },
    [bot.token, bot.user],
  );

  const page = await ctx.newPage();
  await page.goto(`${BASE}/play/${CODIGO}?token=${passe.dados.seatToken}`);
  await page.getByRole('heading', { name: 'Sala de espera' }).waitFor({ timeout: 40_000 });
  abertos.push(ctx);
  console.log(`  ${bot.username} sentou`);
  return page;
}

console.log(`\nabrindo a sala ${CODIGO}…`);
const paginas = [];
for (const bot of BOTS) paginas.push(await sentar(bot));

// Os convidados confirmam; o anfitrião (assento 0) inicia. O gate de "todos
// prontos" é do servidor — sem isto o botão de iniciar fica desabilitado.
for (const page of paginas.slice(1)) {
  await page.getByRole('button', { name: /Estou pronto/ }).click();
}
await paginas[0].getByRole('button', { name: 'Iniciar partida' }).click();

// Cada um fica com a mão inicial: sem isso o modal de mulligan segue aberto e
// o bot aparece congelado atrás dele para quem entrar depois.
for (const page of paginas) {
  await page
    .getByRole('button', { name: 'Manter mão' })
    .click({ timeout: 40_000 })
    .catch(() => {});
}

console.log(`
┌───────────────────────────────────────────────┐
│  SALA PRONTA — partida em andamento           │
│                                               │
│  Código:  ${CODIGO}                              │
│  Entre em ${BASE}       │
│  como aether_dora@aethertable.test            │
│  senha  ${senha}                     │
│                                               │
│  Ctrl+C aqui encerra e os três saem da mesa.  │
└───────────────────────────────────────────────┘
`);

// Segura o processo. Sem isto o Node encerraria, os contextos fechariam e os
// três sairiam da mesa no exato momento em que alguém fosse olhar.
setInterval(() => {}, 1 << 30);

const encerrar = async () => {
  for (const ctx of abertos) await ctx.close().catch(() => {});
  await navegador.close().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
