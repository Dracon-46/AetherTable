#!/usr/bin/env node
/**
 * decks-iniciais.mjs — gera as listas dos decks iniciais a partir do MTGJSON.
 *
 * ─── POR QUE O MTGJSON, E NÃO UM SITE DE DECKS ─────────────────────────────
 *
 * Os decks iniciais são os pré-montados OFICIAIS de Commander. A lista de um
 * produto lacrado é fato público, e o MTGJSON a publica em JSON aberto
 * (licença MIT), com o `scryfallId` de cada carta — exatamente a chave que o
 * AetherTable guarda num deck. Raspar o HTML de um site de decks (LigaMagic,
 * Moxfield) quebraria a cada mudança de layout e esbarraria nos termos de uso
 * deles.
 *
 * ─── POR QUE GERAR UM ARQUIVO, E NÃO BUSCAR EM TEMPO DE EXECUÇÃO ───────────
 *
 * O resultado é commitado (`decks-iniciais.dados.ts`): a API não depende do
 * MTGJSON estar no ar, a lista é revisada como qualquer código, e trocar a
 * seleção é rodar este script de novo com outra lista abaixo.
 *
 * Uso: node tools/decks-iniciais.mjs
 */

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = resolve(RAIZ, 'apps/backend-core/src/decks/decks-iniciais.dados.ts');
const BASE = 'https://mtgjson.com/api/v5';

/**
 * A seleção. Commander oficial e recente, cobrindo as cinco cores, sem edição
 * de colecionador (mesma lista, outra arte) e sem Secret Lair.
 */
const SELECAO = [
  'CallingAllAngels_FDC',
  'KeenEngineering_FDC',
  'ReignOfDragons_FDC',
  'TramplesaurusRex_FDC',
  'WretchedRanks_FDC',
  'LoreholdSpirit_SOC',
  'PrismariArtistry_SOC',
  'QuandrixUnlimited_SOC',
  'SilverquillInfluence_SOC',
  'WitherbloomPestilence_SOC',
  'CounterIntelligence_EOC',
  'WorldShaper_EOC',
];

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

async function baixar(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} respondeu ${res.status}`);
  return res.json();
}

/** Junta cópias da mesma impressão no mesmo board: a chave do banco é única. */
function linhas(cartas, boardType) {
  const porId = new Map();
  for (const c of cartas ?? []) {
    const id = c.identifiers?.scryfallId;
    if (!id) throw new Error(`carta sem scryfallId: ${c.name}`);
    porId.set(id, (porId.get(id) ?? 0) + (c.count ?? 1));
  }
  return [...porId].map(([scryfallId, quantity]) => ({ scryfallId, quantity, boardType }));
}

const lista = await baixar(`${BASE}/DeckList.json`);
const versao = lista.meta?.version ?? 'desconhecida';
const decks = [];

for (const arquivo of SELECAO) {
  const { data } = await baixar(`${BASE}/decks/${arquivo}.json`);
  const comandantes = data.commander ?? [];
  if (comandantes.length === 0) throw new Error(`${arquivo}: sem comandante`);
  const cartas = [...linhas(comandantes, 'COMMANDER'), ...linhas(data.mainBoard, 'MAIN')];
  const total = cartas.reduce((s, c) => s + c.quantity, 0);
  if (total !== 100) throw new Error(`${arquivo}: ${total} cartas, e não 100`);
  const cores = new Set(comandantes.flatMap((c) => c.colorIdentity ?? []));
  decks.push({
    codigo: arquivo,
    nome: data.name,
    colecao: data.code,
    lancamento: data.releaseDate,
    comandantes: comandantes.map((c) => c.identifiers.scryfallId),
    nomesDosComandantes: comandantes.map((c) => c.name),
    cores: WUBRG.filter((c) => cores.has(c)),
    cartas,
  });
  console.log(`${arquivo}: ${data.name} (${comandantes.map((c) => c.name).join(' & ')})`);
}

const conteudo = `/**
 * decks-iniciais.dados.ts — GERADO por \`tools/decks-iniciais.mjs\`. Não edite à mão.
 *
 * Listas oficiais dos decks pré-montados de Commander, do MTGJSON
 * (${versao}, licença MIT). Para trocar a seleção, edite \`SELECAO\` no script e
 * rode \`node tools/decks-iniciais.mjs\`.
 */

export interface DeckInicial {
  codigo: string;
  nome: string;
  colecao: string;
  lancamento: string;
  comandantes: string[];
  nomesDosComandantes: string[];
  cores: string[];
  cartas: Array<{ scryfallId: string; quantity: number; boardType: 'COMMANDER' | 'MAIN' }>;
}

export const FONTE_DOS_DECKS_INICIAIS = 'MTGJSON ${versao} (licença MIT)';

export const DECKS_INICIAIS: readonly DeckInicial[] = ${JSON.stringify(decks)};
`;

writeFileSync(SAIDA, conteudo);
// Formata como o resto do repositório: o \`format:check\` do CI recusaria a
// linha única de dezenas de milhares de caracteres.
execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['prettier', '--write', SAIDA], {
  cwd: RAIZ,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
console.log(`\n${decks.length} decks gravados em ${SAIDA}`);
