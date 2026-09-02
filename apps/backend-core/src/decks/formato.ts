import { BadRequestException } from '@nestjs/common';

/**
 * formato.ts — as travas de legalidade de um deck, num lugar só.
 *
 * ─── POR QUE ELAS SAÍRAM DE `matches.service.ts` ───────────────────────────
 *
 * Elas viviam dentro de `joinMatch`, e o comentário no topo do teste daquele
 * serviço explicava o porquê: `joinMatch` era o único ponto do sistema que
 * conhecia o deck INTEIRO e o formato ao mesmo tempo. Depois dali só existia o
 * `seatToken`, com um id de deck lá dentro, e o game-server provisionava o que
 * viesse.
 *
 * Isso deixou de ser verdade quando o grimório passou a ser escolhido DENTRO da
 * sala de espera (`INTENT_SET_DECK`): agora existe um segundo caminho pelo qual
 * um deck entra na mesa, e ele não passa por `joinMatch`. Uma regra escrita só
 * lá seria uma regra que vale num caminho e não no outro — quer dizer, uma
 * regra que não vale.
 *
 * Aqui elas são uma função pura sobre o decklist, chamada pelos dois caminhos.
 */

/** O mínimo que a validação precisa saber sobre uma carta do deck. */
export interface CartaDoDeck {
  quantity?: number;
  boardType?: string;
  name?: string;
  isBanned?: boolean;
}

export interface DeckValidavel {
  formatId?: string | null;
  cardCount?: number;
  cards: CartaDoDeck[];
}

/**
 * Tamanho mínimo de deck por formato. A validação original exigia EXATAMENTE
 * 100 cartas para qualquer formato: com um deck de Standard ou Modern (60
 * cartas) o `join` respondia 400 e o jogador nunca entrava na mesa — sem
 * nenhuma pista de que o problema era o formato.
 */
const TAMANHO_POR_FORMATO: Record<string, { min: number; exato?: number }> = {
  commander: { min: 100, exato: 100 },
  brawl: { min: 60, exato: 60 },
  standard: { min: 60 },
  modern: { min: 60 },
  pauper: { min: 60 },
  legacy: { min: 60 },
  vintage: { min: 60 },
  timeless: { min: 60 },
};

/** Formatos em que entrar sem comandante não faz sentido. */
const FORMATOS_COM_COMANDANTE = new Set(['commander', 'brawl']);

/** Dois cobre a dupla de parceiros; três em diante não é regra de nenhum formato. */
const MAX_COMANDANTES = 2;

/** Só estes board types contam como "o deck". Reserva e maybeboard ficam fora. */
const NA_CONTAGEM = new Set(['MAIN', 'COMMANDER', 'SIGNATURE_SPELL']);

/**
 * CONTA AS CARTAS DE VERDADE, NÃO O CONTADOR.
 *
 * `deck.cardCount` é desnormalizado: mantido por `increment`/`decrement` a cada
 * mutação, em statements SEPARADOS da escrita da carta e — fora do import — SEM
 * TRANSAÇÃO. Basta a segunda operação falhar (o Neon do plano gratuito
 * autossuspende, a conexão pooled cai) para a carta entrar e o contador não
 * andar.
 *
 * Validar contra o contador significa recusar mesa por causa de um número
 * errado, com a mensagem "seu grimório possui 97 cartas" enquanto a tela do
 * deckbuilder mostra 100. O jogador não tem como resolver isso: o deck dele
 * está certo.
 */
export function contarCartas(cards: CartaDoDeck[]): number {
  return cards.reduce(
    // `quantity` é `@default(1)` no schema: uma linha de DeckCard é, no mínimo,
    // uma carta. Assumir 0 na ausência descartaria cartas reais.
    (soma, c) => (NA_CONTAGEM.has(c.boardType ?? 'MAIN') ? soma + (c.quantity ?? 1) : soma),
    0,
  );
}

/**
 * Recusa o deck que não pode entrar numa mesa deste formato.
 *
 * `formatoDaSala` vence `deck.formatId` quando informado: a sala é que define o
 * que está sendo jogado. Sem isso, levar um deck marcado como "commander" para
 * uma sala de Modern passaria pela regra errada.
 */
export function validarDeckParaFormato(deck: DeckValidavel, formatoDaSala?: string): void {
  const formato = String(formatoDaSala || deck.formatId || 'commander').toLowerCase();
  const regra = TAMANHO_POR_FORMATO[formato] ?? { min: 60 };
  const total = contarCartas(deck.cards);

  // Contador divergente não bloqueia ninguém, mas precisa aparecer no log: é o
  // sintoma de uma escrita que falhou pela metade.
  if (deck.cardCount !== undefined && total !== deck.cardCount) {
    console.warn(`[decks] cardCount dessincronizado: contador=${deck.cardCount}, real=${total}`);
  }

  if (regra.exato !== undefined && total !== regra.exato) {
    throw new BadRequestException(
      `O grimório possui ${total} cartas, mas ${formato} exige exatamente ${regra.exato}.`,
    );
  }
  if (regra.exato === undefined && total < regra.min) {
    throw new BadRequestException(
      `O grimório possui ${total} cartas, mas ${formato} exige no mínimo ${regra.min}.`,
    );
  }

  // Trava de comandante.
  //
  // A contagem passava, o deck entrava, e o `AetherRoom` provisionava uma zona
  // de comando VAZIA: partida de Commander sem comandante, com imposto e dano
  // de comandante que nunca teriam de onde sair. O sintoma aparecia só na mesa,
  // depois de todo mundo já ter entrado.
  if (FORMATOS_COM_COMANDANTE.has(formato)) {
    const comandantes = deck.cards.filter((c) => c.boardType === 'COMMANDER');
    if (comandantes.length === 0) {
      throw new BadRequestException(
        `O formato ${formato} exige um comandante. Abra o deck e marque a carta como comandante antes de entrar na mesa.`,
      );
    }
    if (comandantes.length > MAX_COMANDANTES) {
      throw new BadRequestException(
        `O deck tem ${comandantes.length} comandantes; o máximo é ${MAX_COMANDANTES} (parceiros).`,
      );
    }
  }

  const banidas = deck.cards.filter((c) => c.isBanned);
  if (banidas.length > 0) {
    const nomes = banidas.map((c) => c.name ?? 'carta desconhecida').join(', ');
    throw new BadRequestException(`Seu grimório possui cartas banidas: ${nomes}.`);
  }
}
