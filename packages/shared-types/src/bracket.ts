/**
 * bracket.ts — a estimativa de bracket de Commander, num lugar só.
 *
 * ─── O QUE EXISTIA ANTES ───────────────────────────────────────────────────
 *
 * Uma heurística de PONTOS no frontend (`deckbuilder/agrupar.ts`): duas listas
 * de nomes escritas à mão, 3 pontos para as "cEDH" e 1 para as "fortes", e
 * faixas de 2/4/7/10 pontos para cada bracket. Nada disso é a regra oficial, e
 * o resultado errava nos dois sentidos:
 *
 *   - Rhystic Study + Cyclonic Rift + Smothering Tithe + Teferi's Protection
 *     são QUATRO Game Changers — bracket 4 no mínimo — e o chip dizia "3".
 *   - Necropotence, Ad Nauseam, Natural Order, The One Ring… não estavam em
 *     lista nenhuma. Um deck com dez Game Changers aparecia como "Bracket 1".
 *   - Sol Ring, Sylvan Library, Mystic Remora e Craterhoof NÃO são Game
 *     Changers e somavam ponto; Mana Crypt, Jeweled Lotus e Dockside são
 *     BANIDAS desde setembro de 2024 e somavam 3 cada.
 *   - A reserva e o maybeboard contavam, e o chip aparecia num deck de Modern.
 *
 * ─── O QUE É A REGRA, E O QUE DÁ PARA CALCULAR DELA ─────────────────────────
 *
 * Dos critérios oficiais, só UM é objetivo: quantos Game Changers o deck tem.
 *
 *   0 Game Changers   → bracket 1 ou 2
 *   1 a 3             → bracket 3 no mínimo
 *   4 ou mais         → bracket 4 no mínimo
 *
 * Destruição de terrenos em massa, turnos extras encadeados e combos de duas
 * cartas dependem de COMO o deck joga, e o bracket 5 é intenção competitiva.
 * Isso fica com a mesa (RN01): o sistema não tem motor de regras e não finge
 * ter. Por isso o resultado é um PISO e se chama estimativa.
 *
 * ─── POR QUE A MARCAÇÃO DA SCRYFALL E NÃO UMA LISTA ────────────────────────
 *
 * A lista oficial muda — mudou em abril de 2025 e de novo depois. Uma lista
 * transcrita aqui envelhece em silêncio, que é exatamente o defeito acima. A
 * Scryfall publica `game_changer: boolean` em cada carta, e o backend já
 * guarda o objeto cru no cache: a fonte de verdade chega de graça.
 */

import { acharFormato } from './format';
import { formatoTemNivelDePoder } from './sala';

/**
 * `true` quando a escala de brackets se aplica ao formato.
 *
 * ─── ZONA DE COMANDO NÃO BASTA ──────────────────────────────────────────────
 *
 * A primeira versão usava só `formatoTemNivelDePoder` — "tem comandante" — e o
 * chip aparecia em Duel Commander, Brawl, PDH e Oathbreaker. Os brackets e a
 * lista de Game Changers são do Commander MULTIJOGADOR, sobre a banlist de
 * Commander: Duel Commander e Brawl têm banlist própria (uma carta pode ser
 * Game Changer e banida lá, ou nenhuma das duas), PDH só tem comuns, e num
 * duelo "Bracket 4" não descreve expectativa nenhuma de mesa.
 *
 * O critério sai do catálogo, não de uma lista de ids: banlist de Commander
 * (`chaveDeLegalidade === 'commander'`) E mesa para mais de dois. Isso deixa
 * dentro Commander, Two-Headed Giant e Emperor, e fora o 1v1 do MTGO — que é
 * a mesma banlist, mas um duelo.
 */
export function formatoTemBracket(formatId?: string | null): boolean {
  if (!formatoTemNivelDePoder(formatId)) return false;
  const formato = acharFormato(formatId);
  return formato.deck.chaveDeLegalidade === 'commander' && formato.jogadores.max > 2;
}

/** O mínimo que a estimativa precisa saber de uma carta. */
export interface CartaParaBracket {
  name?: string;
  boardType?: string;
  /**
   * `game_changer` da Scryfall. `undefined` = a hidratação não trouxe (Scryfall
   * fora, carta ainda subindo) — e isso é diferente de `false`.
   */
  gameChanger?: boolean;
}

export interface EstimativaDeBracket {
  /** Piso pela contagem de Game Changers: 1 (nenhum), 3 (1–3) ou 4 (4+). */
  minimo: 1 | 3 | 4;
  /** Teto que a contagem permite afirmar: 2 sem Game Changers, 5 com. */
  maximo: 2 | 5;
  /** Nomes distintos, em ordem alfabética. */
  gameChangers: string[];
  /**
   * Cartas sem a marcação. Com qualquer uma delas o piso pode estar BAIXO
   * demais, e a interface precisa dizer isso em vez de afirmar "1–2".
   */
  semDados: number;
}

/** Os mesmos board types que `contarCartas` considera "o deck". */
const NO_DECK = new Set(['MAIN', 'COMMANDER', 'SIGNATURE_SPELL']);

/**
 * Estima o bracket pela única regra objetiva. `null` fora do Commander
 * multijogador — ver `formatoTemBracket`. "Bracket 1" num deck de Modern, ou de
 * Duel Commander, era uma afirmação sem sentido que o chip fazia.
 */
export function estimarBracket(
  cards: readonly CartaParaBracket[],
  formatId?: string | null,
): EstimativaDeBracket | null {
  if (!formatoTemBracket(formatId)) return null;

  const noDeck = cards.filter((c) => NO_DECK.has(c.boardType ?? 'MAIN'));
  if (noDeck.length === 0) return null;

  // Por NOME, não por linha: duas impressões da mesma carta são duas linhas
  // (a chave única é deck+impressão+board) e contavam como dois Game Changers.
  const nomes = new Set<string>();
  let semDados = 0;
  for (const c of noDeck) {
    if (c.gameChanger === undefined || !c.name) semDados++;
    else if (c.gameChanger) nomes.add(c.name);
  }

  const gameChangers = [...nomes].sort((a, b) => a.localeCompare(b));
  const n = gameChangers.length;
  return {
    minimo: n === 0 ? 1 : n <= 3 ? 3 : 4,
    maximo: n === 0 ? 2 : 5,
    gameChangers,
    semDados,
  };
}

/** "Bracket 1–2", "Bracket 3+", "Bracket 4–5" — sem fingir precisão. */
export function rotuloDoBracket(e: EstimativaDeBracket): string {
  if (e.minimo === 1) return 'Bracket 1–2';
  if (e.minimo === 3) return 'Bracket 3+';
  return 'Bracket 4–5';
}
