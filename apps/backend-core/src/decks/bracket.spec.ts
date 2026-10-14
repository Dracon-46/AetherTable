import { avaliarLegalidade, estimarBracket, type CartaValidavel } from '@aethertable/shared-types';

/**
 * bracket.spec.ts — a estimativa de bracket pela regra oficial.
 *
 * O chip do deckbuilder era uma heurística de pontos com 25 nomes escritos à
 * mão. Cada caso abaixo é um deck que o chip classificava errado: quatro Game
 * Changers apareciam como "Bracket 3", dez apareciam como "Bracket 1", e Sol
 * Ring — que não é Game Changer — subia o bracket.
 */

/** 99 cartas comuns + comandante, todas com a marcação da Scryfall presente. */
function deck(extras: CartaValidavel[] = []): CartaValidavel[] {
  const base: CartaValidavel[] = Array.from({ length: 99 - extras.length }, (_, i) => ({
    scryfallId: `c-${i}`,
    name: `Carta ${i}`,
    quantity: 1,
    boardType: 'MAIN',
    gameChanger: false,
  }));
  return [
    { scryfallId: 'cmd', name: 'Atraxa', boardType: 'COMMANDER', quantity: 1, gameChanger: false },
    ...base,
    ...extras,
  ];
}

const gc = (name: string, boardType = 'MAIN'): CartaValidavel => ({
  scryfallId: `gc-${name}-${boardType}`,
  name,
  boardType,
  quantity: 1,
  gameChanger: true,
});

describe('estimarBracket — a contagem de Game Changers define o piso', () => {
  it('sem Game Changers: bracket 1–2, mesmo com Sol Ring e Sylvan Library', () => {
    const naoSao: CartaValidavel[] = ['Sol Ring', 'Sylvan Library', 'Mystic Remora'].map(
      (name) => ({
        scryfallId: name,
        name,
        boardType: 'MAIN',
        quantity: 1,
        gameChanger: false,
      }),
    );
    const e = estimarBracket(deck(naoSao), 'commander');
    expect(e).toMatchObject({ minimo: 1, maximo: 2, gameChangers: [] });
  });

  it('um a três Game Changers: bracket 3 no mínimo', () => {
    expect(estimarBracket(deck([gc('Demonic Tutor')]), 'commander')?.minimo).toBe(3);
    const tres = [gc('Rhystic Study'), gc('Cyclonic Rift'), gc('Smothering Tithe')];
    expect(estimarBracket(deck(tres), 'commander')?.minimo).toBe(3);
  });

  /** O caso que o chip errava: quatro Game Changers "de 1 ponto" davam 3. */
  it('quatro Game Changers: bracket 4 no mínimo', () => {
    const quatro = ['Rhystic Study', 'Cyclonic Rift', 'Smothering Tithe', "Teferi's Protection"];
    expect(estimarBracket(deck(quatro.map((n) => gc(n))), 'commander')?.minimo).toBe(4);
  });

  it('reserva e maybeboard não contam', () => {
    const fora = [gc('Necropotence', 'SIDEBOARD'), gc('Ad Nauseam', 'MAYBEBOARD')];
    expect(estimarBracket(deck(fora), 'commander')?.gameChangers).toEqual([]);
  });

  it('duas impressões da mesma carta contam uma vez', () => {
    const duas = [gc('Demonic Tutor'), { ...gc('Demonic Tutor'), scryfallId: 'outra-impressao' }];
    expect(estimarBracket(deck(duas), 'commander')?.gameChangers).toEqual(['Demonic Tutor']);
  });

  it('o comandante conta', () => {
    const cartas = deck().map((c) =>
      c.boardType === 'COMMANDER' ? { ...c, gameChanger: true } : c,
    );
    expect(estimarBracket(cartas, 'commander')?.minimo).toBe(3);
  });

  /**
   * Scryfall fora do ar devolvia o deck sem nome, e o chip mostrava o MENOR
   * bracket. Falta de dado não pode virar afirmação de deck fraco.
   */
  it('carta sem a marcação entra como "sem dados", não como "não é Game Changer"', () => {
    const cartas = deck().map((c, i) => (i < 5 ? { ...c, gameChanger: undefined } : c));
    expect(estimarBracket(cartas, 'commander')?.semDados).toBe(5);
  });

  it('fora de formato com comandante não existe bracket', () => {
    expect(estimarBracket(deck([gc('Force of Will')]), 'modern')).toBeNull();
  });

  /**
   * Ter zona de comando não basta. O chip aparecia em Duel Commander, Brawl e
   * PDH, que têm banlist própria ou pool próprio — e em duelos, onde "Bracket
   * 4" não descreve expectativa nenhuma de mesa. A escala é do Commander
   * multijogador, sobre a banlist de Commander.
   */
  it.each(['duel_commander', 'commander_1v1', 'brawl', 'historic_brawl', 'pdh', 'oathbreaker'])(
    '%s não tem bracket',
    (formato) => {
      expect(estimarBracket(deck([gc('Demonic Tutor')]), formato)).toBeNull();
    },
  );

  it.each(['commander', 'commander_2hg', 'commander_emperor', 'planechase'])(
    '%s tem bracket — Commander multijogador, banlist de Commander',
    (formato) => {
      expect(estimarBracket(deck([gc('Demonic Tutor')]), formato)?.minimo).toBe(3);
    },
  );
});

describe('avaliarLegalidade — bracket contra o nível declarado da sala', () => {
  it('avisa quando o deck passa do nível da mesa, sem impedir a entrada', () => {
    const quatro = ['Rhystic Study', 'Cyclonic Rift', 'Smothering Tithe', 'Demonic Tutor'];
    const legal = avaliarLegalidade(
      { formatId: 'commander', cards: deck(quatro.map((n) => gc(n))) },
      undefined,
      2,
    );
    const achado = legal.achados.find((a) => a.codigo === 'BRACKET_ACIMA_DA_MESA');
    expect(achado?.gravidade).toBe('aviso');
    expect(achado?.cartas).toHaveLength(4);
  });

  it('não avisa quando a sala não declarou nível', () => {
    const legal = avaliarLegalidade({ formatId: 'commander', cards: deck([gc('Demonic Tutor')]) });
    expect(legal.achados.some((a) => a.codigo === 'BRACKET_ACIMA_DA_MESA')).toBe(false);
    expect(legal.bracket?.minimo).toBe(3);
  });
});
