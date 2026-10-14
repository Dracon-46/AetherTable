/**
 * montagem.ts — o molde do deck aleatório e o sorteio dentro dele.
 *
 * ─── O MOLDE ───────────────────────────────────────────────────────────────
 *
 * Um deck de Commander jogável tem esqueleto, e o esqueleto é conhecido: 36
 * terrenos, uns dez de ramp, uns dez de compra, uma dúzia de respostas e o
 * resto para o plano do comandante. Montar ao acaso sem esqueleto produz o
 * deck que ninguém quer jogar — 40 criaturas e nenhum jeito de comprar carta.
 *
 * ─── O SORTEIO ─────────────────────────────────────────────────────────────
 *
 * Cada papel vem de uma busca ordenada pela popularidade no EDHREC. Pegar
 * sempre as do topo daria o MESMO deck para o mesmo comandante; sortear entre
 * as N mais jogadas (N = três vezes o que o papel pede) mantém a qualidade e
 * varia o resultado. O sorteador é injetado: produção usa o CSPRNG do Node,
 * o teste usa uma sequência fixa.
 *
 * Função pura: as buscas acontecem no serviço; aqui só se escolhe.
 */

import type { CartaComTexto, Tema } from './temas.js';

/** O mínimo de uma carta candidata. */
export interface Candidata extends CartaComTexto {
  id: string;
  oracle_id?: string;
  mana_cost?: string;
  color_identity?: string[];
  game_changer?: boolean;
}

export interface Pools {
  terrenosUteis: Candidata[];
  ramp: Candidata[];
  compra: Candidata[];
  remocao: Candidata[];
  limpeza: Candidata[];
  temaCriaturas: Candidata[];
  temaOutras: Candidata[];
  criaturas: Candidata[];
  outras: Candidata[];
}

/** Impressão de cada básico, por cor (`C` = Wastes, para comandante incolor). */
export type Basicos = Partial<Record<'W' | 'U' | 'B' | 'R' | 'G' | 'C', string>>;

export const MOLDE = {
  terrenos: 36,
  ramp: 10,
  compra: 10,
  remocao: 8,
  limpeza: 3,
  /** Do que sobra para o tema, quantas são criaturas. */
  criaturasDoTema: 20,
} as const;

/** Terrenos não básicos por número de cores: quanto mais cores, mais conserto de mana. */
export function terrenosUteisPara(cores: number): number {
  if (cores <= 0) return 2;
  if (cores === 1) return 4;
  if (cores === 2) return 8;
  if (cores === 3) return 10;
  return 12;
}

export interface Linha {
  scryfallId: string;
  quantity: number;
  boardType: 'COMMANDER' | 'MAIN';
}

export interface DeckMontado {
  linhas: Linha[];
  /** Quantas cartas saíram de cada papel — vai para a descrição do deck. */
  contagem: Record<string, number>;
}

const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;

/** Sorteia `n` de `lista` sem repetir, entre as `janela` primeiras. */
function sortearDe<T>(
  lista: T[],
  n: number,
  janela: number,
  sortear: (max: number) => number,
): T[] {
  const pote = lista.slice(0, Math.max(n, janela));
  const escolhidas: T[] = [];
  while (escolhidas.length < n && pote.length > 0) {
    const [item] = pote.splice(sortear(pote.length), 1);
    if (item !== undefined) escolhidas.push(item);
  }
  return escolhidas;
}

/** Símbolos coloridos no custo: `{2}{R}{R/G}` conta R duas vezes e G uma. */
function pipsDe(custo: string | undefined): Record<string, number> {
  const pips: Record<string, number> = {};
  for (const simbolo of custo?.match(/\{[^}]+\}/g) ?? []) {
    for (const cor of WUBRG) if (simbolo.includes(cor)) pips[cor] = (pips[cor] ?? 0) + 1;
  }
  return pips;
}

/**
 * Divide os básicos pela demanda de cada cor no custo das cartas escolhidas,
 * com pelo menos um de cada cor do comandante — um deck Esper com zero
 * Planícies porque o sorteio trouxe poucas mágicas brancas não conjura o
 * próprio comandante.
 */
export function dividirBasicos(
  cores: string[],
  total: number,
  custos: Array<string | undefined>,
): Record<string, number> {
  if (cores.length === 0) return { C: total };
  const demanda: Record<string, number> = {};
  for (const c of cores) demanda[c] = 1;
  for (const custo of custos) {
    for (const [cor, n] of Object.entries(pipsDe(custo)))
      if (cores.includes(cor)) demanda[cor]! += n;
  }
  const soma = Object.values(demanda).reduce((a, b) => a + b, 0);
  const partes: Record<string, number> = {};
  let usados = 0;
  for (const c of cores) {
    partes[c] = Math.max(1, Math.floor((demanda[c]! / soma) * total));
    usados += partes[c]!;
  }
  // O arredondamento para baixo deixa sobra (ou, com o mínimo de 1, excesso):
  // ajusta na cor de maior demanda, que é a que mais sente falta.
  const maior = [...cores].sort((a, b) => demanda[b]! - demanda[a]!)[0]!;
  partes[maior]! += total - usados;
  return partes;
}

export function montarDeck(
  comandante: Candidata,
  pools: Pools,
  basicos: Basicos,
  sortear: (max: number) => number,
): DeckMontado {
  const cores = WUBRG.filter((c) => comandante.color_identity?.includes(c));
  const usadas = new Set<string>([comandante.oracle_id ?? comandante.name]);
  const contagem: Record<string, number> = {};
  const escolhidas: Candidata[] = [];

  /**
   * Singleton por CARTA (oracle_id), não por impressão; e nunca Game Changer —
   * o deck aleatório é para mesa casual (bracket 1–2), e um Rhystic Study
   * sorteado mudaria o nível da mesa sem ninguém ter escolhido isso.
   */
  const livre = (c: Candidata) =>
    !c.game_changer && !usadas.has(c.oracle_id ?? c.name) && c.id !== comandante.id;

  const pegar = (papel: string, pool: Candidata[], n: number) => {
    if (n <= 0) return 0;
    const disponiveis = pool.filter(livre);
    const tiradas = sortearDe(disponiveis, n, n * 3, sortear);
    for (const c of tiradas) {
      usadas.add(c.oracle_id ?? c.name);
      escolhidas.push(c);
    }
    contagem[papel] = (contagem[papel] ?? 0) + tiradas.length;
    return tiradas.length;
  };

  const uteis = pegar('terrenos não básicos', pools.terrenosUteis, terrenosUteisPara(cores.length));
  pegar('ramp', pools.ramp, MOLDE.ramp);
  pegar('compra', pools.compra, MOLDE.compra);
  pegar('remoção', pools.remocao, MOLDE.remocao);
  pegar('limpeza de mesa', pools.limpeza, MOLDE.limpeza);

  // O tema: o que sobra das 99 depois dos terrenos e dos papéis fixos.
  // Primeiro as criaturas — do tema e, se o tema não der conta, as mais
  // jogadas da identidade —, depois o resto. Um deck sem criaturas suficientes
  // não pressiona ninguém, mesmo com o tema certo.
  let restante = 99 - MOLDE.terrenos - (escolhidas.length - uteis);
  const alvoDeCriaturas = Math.min(MOLDE.criaturasDoTema, restante);
  let criaturas = pegar('criaturas do tema', pools.temaCriaturas, alvoDeCriaturas);
  criaturas += pegar('criaturas', pools.criaturas, alvoDeCriaturas - criaturas);
  restante -= criaturas;
  restante -= pegar('outras do tema', pools.temaOutras, restante);
  restante -= pegar('outras', pools.outras, restante);
  restante -= pegar('criaturas', pools.criaturas, restante);

  // Básicos: os terrenos que faltam para 36, mais o que nenhum pool conseguiu
  // preencher — um deck de 100 cartas com terreno a mais joga; com 97, não entra.
  const totalBasicos = MOLDE.terrenos - uteis + Math.max(0, restante);
  const divisao = dividirBasicos(
    cores,
    totalBasicos,
    [comandante, ...escolhidas].map((c) => c.mana_cost),
  );

  const linhas: Linha[] = [
    { scryfallId: comandante.id, quantity: 1, boardType: 'COMMANDER' },
    ...escolhidas.map((c) => ({ scryfallId: c.id, quantity: 1, boardType: 'MAIN' as const })),
  ];
  for (const [cor, quantidade] of Object.entries(divisao)) {
    const id = basicos[cor as keyof Basicos];
    if (id && quantidade > 0)
      linhas.push({ scryfallId: id, quantity: quantidade, boardType: 'MAIN' });
  }
  contagem['terrenos básicos'] = totalBasicos;
  return { linhas, contagem };
}

/** A descrição que fica no deck: de onde ele veio e como foi montado. */
export function descreverDeck(
  comandante: Candidata,
  temas: Tema[],
  contagem: Record<string, number>,
): string {
  const tema = temas.length ? temas.map((t) => t.nome).join(', ') : 'sem tema específico';
  const partes = Object.entries(contagem)
    .filter(([, n]) => n > 0)
    .map(([papel, n]) => `${n} ${papel}`)
    .join(', ');
  return `Montado automaticamente em volta de ${comandante.name}. Tema: ${tema}. ${partes}.`;
}
