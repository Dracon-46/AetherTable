/**
 * motor.ts — o draft contra robôs: pacotes, escolhas e a roda.
 *
 * Oito lugares, três pacotes de 14 cartas por lugar. Em cada rodada todo mundo
 * abre um pacote, pega uma carta e passa o resto — para a ESQUERDA na primeira
 * e na terceira rodada, para a DIREITA na segunda (é a regra do Booster
 * Draft). O lugar 0 é a pessoa; os outros sete são robôs.
 *
 * Função pura do começo ao fim: recebe as cartas da coleção e um sorteador, e
 * devolve estado novo. Sem rede, sem React — o que deixa a roda inteira
 * testável com um sorteador fixo.
 *
 * ─── COMO O ROBÔ ESCOLHE ───────────────────────────────────────────────────
 *
 * Sem dado de "qualidade em limitado" à mão (as notas de draft não têm API
 * aberta), o robô faz o que um jogador iniciante sensato faz: pega a carta
 * mais rara nas primeiras escolhas e, a partir da quinta, se compromete com as
 * duas cores que mais pegou e passa a preferir cartas delas. Um pouco de
 * ruído impede que os sete robôs sejam o mesmo robô.
 */

import type { Sorteador } from '../desafios/cartas';

export interface CartaDeDraft {
  id: string;
  name: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'mythic' | string;
  colors?: string[];
  card_faces?: Array<{ colors?: string[] }>;
  type_line?: string;
  cmc?: number;
  set?: string;
  collector_number?: string;
}

export const LUGARES = 8;
export const RODADAS = 3;
export const CARTAS_POR_PACOTE = 14;

const PESO_DA_RARIDADE: Record<string, number> = { common: 1, uncommon: 2, rare: 3.5, mythic: 4 };

export const coresDe = (c: CartaDeDraft): string[] =>
  c.colors ?? [...new Set((c.card_faces ?? []).flatMap((f) => f.colors ?? []))];

const ehBasico = (c: CartaDeDraft) => /\bBasic\b.*\bLand\b/i.test(c.type_line ?? '');

/**
 * Um pacote de 14: uma rara (mítica uma vez em oito), três incomuns e dez
 * comuns, sem repetir carta dentro do pacote e sem terreno básico — o espaço
 * do básico de um pacote real não decide nada no draft.
 */
export function montarPacote(colecao: readonly CartaDeDraft[], sortear: Sorteador): CartaDeDraft[] {
  const por = (r: string) => colecao.filter((c) => c.rarity === r && !ehBasico(c));
  const miticas = por('mythic');
  const raras = por('rare');
  const pacote: CartaDeDraft[] = [];
  const usadas = new Set<string>();
  const tirar = (lista: CartaDeDraft[], n: number) => {
    const livres = lista.filter((c) => !usadas.has(c.id));
    for (let i = 0; i < n && livres.length; i++) {
      const [c] = livres.splice(Math.floor(sortear() * livres.length), 1);
      usadas.add(c!.id);
      pacote.push(c!);
    }
  };
  tirar(miticas.length && sortear() < 1 / 8 ? miticas : raras.length ? raras : miticas, 1);
  tirar(por('uncommon'), 3);
  tirar(por('common'), CARTAS_POR_PACOTE - pacote.length);
  return pacote;
}

/** As duas cores em que o robô mais pegou carta — vazio antes de ele se comprometer. */
export function coresDoRobo(escolhidas: readonly CartaDeDraft[]): string[] {
  if (escolhidas.length < 4) return [];
  const conta = new Map<string, number>();
  for (const c of escolhidas) {
    for (const cor of coresDe(c)) conta.set(cor, (conta.get(cor) ?? 0) + 1);
  }
  return [...conta]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([cor]) => cor);
}

export function notaDoRobo(c: CartaDeDraft, cores: readonly string[], ruido: number): number {
  let nota = PESO_DA_RARIDADE[c.rarity] ?? 1;
  if (cores.length) {
    const cs = coresDe(c);
    if (cs.length === 0) nota += 1;
    else if (cs.every((x) => cores.includes(x))) nota += 2;
    else nota -= 1.5;
  }
  return nota + ruido;
}

/** O índice da carta que o robô pega deste pacote. */
export function escolhaDoRobo(
  pacote: readonly CartaDeDraft[],
  escolhidas: readonly CartaDeDraft[],
  sortear: Sorteador,
): number {
  const cores = coresDoRobo(escolhidas);
  let melhor = 0;
  let nota = -Infinity;
  pacote.forEach((c, i) => {
    const n = notaDoRobo(c, cores, sortear() * 0.6);
    if (n > nota) {
      nota = n;
      melhor = i;
    }
  });
  return melhor;
}

export interface EstadoDoDraft {
  rodada: number;
  /** Escolha dentro da rodada, a partir de 0. */
  escolha: number;
  /** O pacote que está na frente de cada lugar agora. */
  pacotes: CartaDeDraft[][];
  /** O que cada lugar já pegou. */
  escolhidas: CartaDeDraft[][];
  terminou: boolean;
}

export function comecarDraft(colecao: readonly CartaDeDraft[], sortear: Sorteador): EstadoDoDraft {
  return {
    rodada: 0,
    escolha: 0,
    pacotes: Array.from({ length: LUGARES }, () => montarPacote(colecao, sortear)),
    escolhidas: Array.from({ length: LUGARES }, () => []),
    terminou: false,
  };
}

/**
 * A pessoa pega a carta `indice` do pacote dela; os robôs pegam as deles; os
 * pacotes andam uma casa. Pacote vazio = fim da rodada: abre-se o seguinte,
 * ou o draft acaba.
 */
export function escolher(
  estado: EstadoDoDraft,
  indice: number,
  colecao: readonly CartaDeDraft[],
  sortear: Sorteador,
): EstadoDoDraft {
  if (estado.terminou) return estado;
  const pacotes = estado.pacotes.map((p) => [...p]);
  const escolhidas = estado.escolhidas.map((e) => [...e]);

  pacotes.forEach((pacote, lugar) => {
    const i = lugar === 0 ? indice : escolhaDoRobo(pacote, escolhidas[lugar]!, sortear);
    const [pega] = pacote.splice(i, 1);
    if (pega) escolhidas[lugar]!.push(pega);
  });

  // Esquerda nas rodadas 1 e 3, direita na 2.
  const passo = estado.rodada === 1 ? -1 : 1;
  const passados = pacotes.map((_, lugar) => pacotes[(lugar - passo + LUGARES) % LUGARES]!);

  if (passados[0]!.length > 0) {
    return { ...estado, escolha: estado.escolha + 1, pacotes: passados, escolhidas };
  }
  if (estado.rodada + 1 >= RODADAS) {
    return { ...estado, pacotes: passados, escolhidas, terminou: true };
  }
  return {
    rodada: estado.rodada + 1,
    escolha: 0,
    pacotes: Array.from({ length: LUGARES }, () => montarPacote(colecao, sortear)),
    escolhidas,
    terminou: false,
  };
}

/**
 * Quantos básicos de cada cor para fechar 40 cartas: proporcional às cores
 * das mágicas escolhidas, com pelo menos um de cada cor usada.
 */
export function sugerirBasicos(
  magicas: readonly CartaDeDraft[],
  total: number,
): Record<string, number> {
  const conta = new Map<string, number>();
  for (const c of magicas) for (const cor of coresDe(c)) conta.set(cor, (conta.get(cor) ?? 0) + 1);
  const cores = [...conta.keys()];
  if (total <= 0) return {};
  if (cores.length === 0) return { C: total };
  const soma = [...conta.values()].reduce((a, b) => a + b, 0);
  const partes: Record<string, number> = {};
  let dados = 0;
  for (const cor of cores) {
    partes[cor] = Math.max(1, Math.floor((conta.get(cor)! / soma) * total));
    dados += partes[cor]!;
  }
  // Acerta a soma na cor mais pedida (para cima ou para baixo).
  const principal = [...conta].sort((a, b) => b[1] - a[1])[0]![0];
  partes[principal] = Math.max(1, partes[principal]! + (total - dados));
  return partes;
}
