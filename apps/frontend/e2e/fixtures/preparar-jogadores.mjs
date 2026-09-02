#!/usr/bin/env node
/**
 * preparar-jogadores.mjs — cria as contas e os grimórios que o E2E de mesa usa.
 *
 * ─── POR QUE ISTO NÃO É PARTE DO TESTE ─────────────────────────────────────
 *
 * Registrar quatro contas e importar quatro decks custa uma dúzia de chamadas à
 * Scryfall. Feito dentro do `beforeAll` de uma suíte, isso vira meio minuto de
 * rede antes de qualquer asserção — e um teste que falha por rate limit da
 * Scryfall não diz nada sobre a mesa.
 *
 * Aqui a preparação roda UMA vez, grava `jogadores.json` e é idempotente: se as
 * contas já existirem, ele só faz login. Rodar de novo é barato.
 *
 * Uso:
 *   node e2e/fixtures/preparar-jogadores.mjs
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.E2E_API_URL ?? 'http://localhost:3333/api/v1';
const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = join(AQUI, 'jogadores.json');

/** Quatro assentos é a mesa clássica de Commander; o teto agora é oito. */
const JOGADORES = ['aether_ana', 'aether_bruno', 'aether_caio', 'aether_dora'];
const SENHA = 'SenhaDeTeste123';

/**
 * Decklist de Commander com exatamente 100 cartas contáveis.
 *
 * Poucos nomes DISTINTOS de propósito: o import resolve nomes na Scryfall em
 * blocos, então sete nomes custam uma chamada — e um `99 Mountain` vira uma
 * linha só no banco e 99 entidades na mesa, que é justamente o que se quer
 * exercitar (grimório grande, muitas cartas iguais compartilhando textura).
 *
 * Há variedade suficiente para as interações importarem: um comandante, uma
 * criatura que gera ficha, um artefato, uma mágica instantânea.
 */
const DECKLIST = [
  '1 Krenko, Mob Boss',
  '1 Sol Ring',
  '1 Lightning Bolt',
  '1 Shock',
  '1 Goblin Matron',
  '1 Skirk Prospector',
  '94 Mountain',
].join('\n');

async function json(res) {
  const texto = await res.text();
  try {
    return JSON.parse(texto);
  } catch {
    return { _raw: texto };
  }
}

async function chamar(caminho, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${caminho}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, dados: await json(res) };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Registra, ou faz login se a conta já existir. Idempotente de propósito.
 *
 * ─── O 429 NÃO É DEFEITO, É A REGRA FUNCIONANDO ────────────────────────────
 *
 * `POST /auth/register` aceita 3 por minuto por IP (auth.controller.ts): o
 * cadastro roda argon2, que é deliberadamente lento, e sem teto um laço simples
 * prende a CPU do único nó do plano gratuito. Preparar quatro contas de uma vez
 * bate nesse limite no quarto — e a versão anterior desta fixture interpretava
 * o 429 como "a conta já existe", tentava login e morria com 401 sobre uma
 * conta que nunca chegou a ser criada.
 *
 * Esperar a janela virar é a resposta certa. Vale o minuto: é uma vez só, e
 * mexer no limite para o teste passar seria afrouxar produção por causa do
 * andaime.
 */
async function entrar(username, { tentativas = 3 } = {}) {
  const email = `${username}@aethertable.test`;

  // Login primeiro: na segunda execução em diante a conta já existe, e isso
  // evita gastar a cota de cadastro à toa.
  const login = await chamar('/auth/login', { method: 'POST', body: { email, password: SENHA } });
  if (login.status < 300) return login.dados;

  for (let i = 0; i < tentativas; i += 1) {
    const registro = await chamar('/auth/register', {
      method: 'POST',
      body: { email, username, password: SENHA },
    });
    if (registro.status < 300) return registro.dados;

    if (registro.status === 429) {
      console.log(`  ${username}: cadastro no limite (3/min) — aguardando a janela virar…`);
      await dormir(62_000);
      continue;
    }

    throw new Error(
      `cadastro de ${username} falhou (${registro.status}): ${JSON.stringify(registro.dados)}`,
    );
  }

  throw new Error(`cadastro de ${username} não passou depois de ${tentativas} tentativas`);
}

/**
 * Garante um deck legal de Commander para a conta.
 *
 * Reaproveita o deck já preparado quando ele existe: o import é a parte cara
 * (Scryfall), e repeti-lo a cada execução é o que faria esta preparação deixar
 * de ser barata.
 */
async function prepararDeck(token) {
  const NOME = 'E2E Krenko';

  const existentes = await chamar('/decks', { token });
  const jaTem = Array.isArray(existentes.dados)
    ? existentes.dados.find((d) => d.name === NOME && (d.cardCount ?? 0) === 100)
    : null;
  if (jaTem) return jaTem.id;

  const criado = await chamar('/decks', {
    method: 'POST',
    token,
    body: { name: NOME, formatId: 'commander' },
  });
  if (criado.status >= 300) throw new Error(`criar deck falhou: ${JSON.stringify(criado.dados)}`);
  const deckId = criado.dados.id;

  const importado = await chamar(`/decks/${deckId}/import`, {
    method: 'POST',
    token,
    body: { decklist: DECKLIST },
  });
  if (importado.status >= 300) {
    throw new Error(`import falhou: ${JSON.stringify(importado.dados)}`);
  }

  // O import põe tudo em MAIN. Sem um COMMANDER marcado, `joinMatch` e
  // `validarDeckParaFormato` recusam o deck — que é o comportamento correto, e
  // por isso a fixture precisa fazer o que um jogador faria no deckbuilder.
  const deck = await chamar(`/decks/${deckId}`, { token });
  const krenko = (deck.dados.cards ?? []).find((c) => (c.name ?? '').startsWith('Krenko'));
  if (!krenko) throw new Error('Krenko não veio no import — a Scryfall não resolveu o nome?');

  const marcado = await chamar(`/decks/${deckId}/cards/${krenko.id}/board-type`, {
    method: 'PATCH',
    token,
    body: { boardType: 'COMMANDER' },
  });
  if (marcado.status >= 300) {
    throw new Error(`marcar comandante falhou: ${JSON.stringify(marcado.dados)}`);
  }

  return deckId;
}

const resultado = [];
for (const username of JOGADORES) {
  const sessao = await entrar(username);
  const token = sessao.accessToken ?? sessao.access_token;
  if (!token) throw new Error(`sem accessToken para ${username}: ${JSON.stringify(sessao)}`);

  const deckId = await prepararDeck(token);
  resultado.push({ username, email: `${username}@aethertable.test`, token, deckId, user: sessao.user });
  console.log(`ok ${username} → deck ${deckId}`);
}

writeFileSync(SAIDA, JSON.stringify({ senha: SENHA, jogadores: resultado }, null, 2));
console.log(`\n${resultado.length} jogadores prontos em ${SAIDA}`);
