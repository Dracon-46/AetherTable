import {
  FORMATOS,
  acharFormato,
  avaliarLegalidade,
  motivoDeBloqueio,
  type CartaValidavel,
} from '@aethertable/shared-types';

/**
 * legalidade.spec.ts — as regras de Magic que o sistema não tinha.
 *
 * Cada bloco aqui corresponde a uma regra que NÃO EXISTIA no código antes: o
 * validador só sabia contar cartas e olhar um booleano `isBanned`. Um deck de
 * Modern com quarenta Lightning Bolt, ou um Commander com quatro Sol Ring,
 * passava sem um aviso.
 *
 * Os testes existem para que isso não volte em silêncio. Uma regra de deck
 * quebrada não derruba nada — ela deixa o sistema aceitar decks ilegais, que é
 * o tipo de defeito que só aparece quando alguém reclama na mesa.
 */

/** Uma carta qualquer, para completar contagem. */
function enche(n: number, extra: Partial<CartaValidavel> = {}): CartaValidavel[] {
  return Array.from({ length: n }, (_, i) => ({
    scryfallId: `c-${i}`,
    name: `Carta ${i}`,
    quantity: 1,
    boardType: 'MAIN',
    typeLine: 'Creature — Human',
    ...extra,
  }));
}

const comandanteLendario: CartaValidavel = {
  scryfallId: 'cmd',
  name: 'Atraxa, Praetors Voice',
  boardType: 'COMMANDER',
  quantity: 1,
  typeLine: 'Legendary Creature — Phyrexian Angel Horror',
  colorIdentity: ['W', 'U', 'B', 'G'],
};

const acharCodigo = (cards: CartaValidavel[], formatId: string, codigo: string) =>
  avaliarLegalidade({ formatId, cards }).achados.find((a) => a.codigo === codigo);

describe('legalidade — o aviso de tamanho fala do formato certo', () => {
  /**
   * O BUG RELATADO. O deckbuilder avisava "o formato Commander exige exatas
   * 100" num deck de Modern, porque a regra era um `if` fixo no componente sem
   * consultar formato nenhum.
   */
  it('não reclama de 100 cartas num deck de Modern — o mínimo lá é 60', () => {
    const legal = avaliarLegalidade({ formatId: 'modern', cards: enche(100) });
    expect(legal.achados.find((a) => a.codigo === 'TAMANHO')).toBeUndefined();
  });

  it('reclama de 40 cartas num deck de Modern', () => {
    const achado = acharCodigo(enche(40), 'modern', 'TAMANHO');
    expect(achado?.mensagem).toMatch(/no mínimo 60/i);
  });

  it('exige exatamente 100 em Commander, nem 99 nem 101', () => {
    const cards = [comandanteLendario, ...enche(98)];
    expect(acharCodigo(cards, 'commander', 'TAMANHO')?.mensagem).toMatch(/exatamente 100/i);
  });

  it('não exige tamanho nenhum em freeform', () => {
    const legal = avaliarLegalidade({ formatId: 'freeform', cards: enche(7) });
    expect(legal.achados.find((a) => a.codigo === 'TAMANHO')).toBeUndefined();
    expect(legal.podeEntrarNaMesa).toBe(true);
  });

  it('um formato desconhecido cai em Commander em vez de explodir', () => {
    // Um `formatId` que saiu do catálogo não pode virar tela em branco: o deck
    // existe no banco e precisa continuar abrindo.
    expect(avaliarLegalidade({ formatId: 'formato-que-nao-existe', cards: [] }).formato.id).toBe(
      'commander',
    );
  });
});

describe('legalidade — limite de cópias', () => {
  it('acusa 5 cópias da mesma carta em Modern', () => {
    const cards = [
      { scryfallId: 'bolt', name: 'Lightning Bolt', quantity: 5, boardType: 'MAIN' },
      ...enche(55),
    ];
    const achado = acharCodigo(cards, 'modern', 'COPIAS');
    expect(achado?.mensagem).toMatch(/Lightning Bolt \(5\)/);
    expect(achado?.gravidade).toBe('aviso');
  });

  it('aceita 4 cópias', () => {
    const cards = [
      { scryfallId: 'bolt', name: 'Lightning Bolt', quantity: 4, boardType: 'MAIN' },
      ...enche(56),
    ];
    expect(acharCodigo(cards, 'modern', 'COPIAS')).toBeUndefined();
  });

  it('soma cópias pelo NOME, não pelo scryfallId', () => {
    // Trocar a arte é a forma mais fácil de furar o limite num deckbuilder:
    // duas impressões diferentes são dois ids e a MESMA carta pelas regras.
    const cards = [
      { scryfallId: 'bolt-a', name: 'Lightning Bolt', quantity: 3, boardType: 'MAIN' },
      { scryfallId: 'bolt-b', name: 'Lightning Bolt', quantity: 3, boardType: 'MAIN' },
      ...enche(54),
    ];
    expect(acharCodigo(cards, 'modern', 'COPIAS')?.mensagem).toMatch(/Lightning Bolt \(6\)/);
  });

  it('terreno básico não tem limite', () => {
    const cards = [
      {
        scryfallId: 'mtn',
        name: 'Mountain',
        quantity: 24,
        boardType: 'MAIN',
        typeLine: 'Basic Land — Mountain',
      },
      ...enche(36),
    ];
    expect(acharCodigo(cards, 'modern', 'COPIAS')).toBeUndefined();
  });
});

describe('legalidade — singleton', () => {
  it('acusa carta repetida em Commander', () => {
    const cards = [
      comandanteLendario,
      { scryfallId: 'sol', name: 'Sol Ring', quantity: 4, boardType: 'MAIN' },
      ...enche(95),
    ];
    expect(acharCodigo(cards, 'commander', 'SINGLETON')?.mensagem).toMatch(/Sol Ring/);
  });

  it('não acusa os 36 terrenos básicos', () => {
    const cards = [
      comandanteLendario,
      {
        scryfallId: 'ilha',
        name: 'Island',
        quantity: 36,
        boardType: 'MAIN',
        typeLine: 'Basic Land — Island',
      },
      ...enche(63),
    ];
    expect(acharCodigo(cards, 'commander', 'SINGLETON')).toBeUndefined();
  });
});

describe('legalidade — banidas, restritas e fora do formato', () => {
  const carta = (situacao: string, nome: string, quantity = 1): CartaValidavel => ({
    scryfallId: nome,
    name: nome,
    quantity,
    boardType: 'MAIN',
    legalities: { modern: situacao, vintage: situacao },
  });

  it('banida bloqueia a entrada na mesa', () => {
    const cards = [carta('banned', 'Skullclamp'), ...enche(59)];
    const legal = avaliarLegalidade({ formatId: 'modern', cards });
    expect(legal.podeEntrarNaMesa).toBe(false);
    expect(motivoDeBloqueio({ formatId: 'modern', cards })).toMatch(/banidas.*Skullclamp/i);
  });

  it('restrita com 2 cópias é AVISO, não bloqueio — e não é a mesma coisa que banida', () => {
    // A Scryfall devolve 'restricted' e o código antigo só olhava 'banned':
    // a lista de restritas do Vintage não existia no sistema.
    const cards = [carta('restricted', 'Black Vise', 2), ...enche(58)];
    const legal = avaliarLegalidade({ formatId: 'vintage', cards });
    expect(legal.achados.find((a) => a.codigo === 'RESTRITA')?.mensagem).toMatch(
      /Black Vise \(2\)/,
    );
    expect(legal.podeEntrarNaMesa).toBe(true);
  });

  it('restrita com 1 cópia não gera achado nenhum', () => {
    const cards = [carta('restricted', 'Black Vise', 1), ...enche(59)];
    expect(acharCodigo(cards, 'vintage', 'RESTRITA')).toBeUndefined();
  });

  it("'not_legal' vira aviso de fora do pool, distinto de banida", () => {
    const cards = [carta('not_legal', 'Ancestral Recall'), ...enche(59)];
    const legal = avaliarLegalidade({ formatId: 'modern', cards });
    expect(legal.achados.find((a) => a.codigo === 'FORA_DO_FORMATO')).toBeDefined();
    expect(legal.podeEntrarNaMesa).toBe(true);
  });

  it('sem `legalities`, cai no `isBanned` pré-computado', () => {
    const cards = [
      { scryfallId: 'x', name: 'Black Lotus', quantity: 1, boardType: 'MAIN', isBanned: true },
      ...enche(59),
    ];
    expect(acharCodigo(cards, 'modern', 'BANIDA')).toBeDefined();
  });

  it('sem dado nenhum, nenhuma regra de legalidade dispara', () => {
    // Uma queda da Scryfall não pode transformar todo deck em ilegal.
    const legal = avaliarLegalidade({
      formatId: 'modern',
      cards: enche(60, { typeLine: undefined, legalities: undefined }),
    });
    expect(legal.achados.map((a) => a.codigo)).not.toContain('BANIDA');
    expect(legal.achados.map((a) => a.codigo)).not.toContain('FORA_DO_FORMATO');
  });
});

describe('legalidade — identidade de cor', () => {
  it('acusa carta fora da identidade do comandante', () => {
    const cards = [
      { ...comandanteLendario, colorIdentity: ['U'] },
      {
        scryfallId: 'bolt',
        name: 'Lightning Bolt',
        quantity: 1,
        boardType: 'MAIN',
        colorIdentity: ['R'],
      },
      ...enche(98),
    ];
    const achado = acharCodigo(cards, 'commander', 'IDENTIDADE_DE_COR');
    expect(achado?.mensagem).toMatch(/azul/);
    expect(achado?.mensagem).toMatch(/Lightning Bolt/);
  });

  it('aceita carta dentro da identidade', () => {
    const cards = [
      { ...comandanteLendario, colorIdentity: ['U', 'R'] },
      {
        scryfallId: 'bolt',
        name: 'Lightning Bolt',
        quantity: 1,
        boardType: 'MAIN',
        colorIdentity: ['R'],
      },
      ...enche(98),
    ];
    expect(acharCodigo(cards, 'commander', 'IDENTIDADE_DE_COR')).toBeUndefined();
  });

  it('devolve a identidade deduzida, em ordem WUBRG', () => {
    const cards = [{ ...comandanteLendario, colorIdentity: ['G', 'W', 'U'] }, ...enche(99)];
    expect(avaliarLegalidade({ formatId: 'commander', cards }).identidadeDeCor).toEqual([
      'W',
      'U',
      'G',
    ]);
  });

  it('não se aplica a formato sem comandante', () => {
    const cards = enche(60, { colorIdentity: ['W', 'U', 'B', 'R', 'G'] });
    expect(acharCodigo(cards, 'modern', 'IDENTIDADE_DE_COR')).toBeUndefined();
  });
});

describe('legalidade — o comandante precisa ser um comandante', () => {
  it('avisa quando a carta marcada não é criatura lendária', () => {
    const cards = [
      {
        scryfallId: 'ilha',
        name: 'Island',
        boardType: 'COMMANDER',
        quantity: 1,
        typeLine: 'Basic Land — Island',
      },
      ...enche(99),
    ];
    // Antes, QUALQUER carta podia ser promovida a comandante — inclusive um
    // terreno — e a validação só conferia que existia alguma.
    expect(acharCodigo(cards, 'commander', 'TIPO_DE_COMANDANTE')?.mensagem).toMatch(/Island/);
  });

  it('Oathbreaker quer um planeswalker, não uma criatura', () => {
    const cards = [{ ...comandanteLendario, boardType: 'COMMANDER' }, ...enche(59)];
    expect(acharCodigo(cards, 'oathbreaker', 'TIPO_DE_COMANDANTE')?.mensagem).toMatch(
      /planeswalker/i,
    );
  });

  it('Oathbreaker avisa quando falta o feitiço-assinatura', () => {
    const cards = [
      {
        scryfallId: 'pw',
        name: 'Jace, Wielder of Mysteries',
        boardType: 'COMMANDER',
        quantity: 1,
        typeLine: 'Legendary Planeswalker — Jace',
        colorIdentity: ['U'],
      },
      ...enche(59, { colorIdentity: ['U'] }),
    ];
    expect(acharCodigo(cards, 'oathbreaker', 'SEM_FEITICO_ASSINATURA')).toBeDefined();
  });

  it('avisa sobre a dupla de parceiros sem impedi-la', () => {
    const cards = [
      comandanteLendario,
      { ...comandanteLendario, scryfallId: 'cmd2', name: 'Tymna the Weaver' },
      ...enche(98),
    ];
    const legal = avaliarLegalidade({ formatId: 'commander', cards });
    expect(legal.podeEntrarNaMesa).toBe(true);
    expect(legal.achados.find((a) => a.codigo === 'TIPO_DE_COMANDANTE')?.mensagem).toMatch(
      /Partner/i,
    );
  });

  it('avisa quando um formato sem comando tem carta marcada como comandante', () => {
    const cards = [comandanteLendario, ...enche(59)];
    const legal = avaliarLegalidade({ formatId: 'modern', cards });
    expect(legal.achados.find((a) => a.codigo === 'COMANDANTES_DEMAIS')?.gravidade).toBe('aviso');
    expect(legal.podeEntrarNaMesa).toBe(true);
  });
});

describe('legalidade — teto de raridade e valor de mana', () => {
  it('Pauper acusa carta rara', () => {
    const cards = [
      {
        scripfallId: 'r',
        scryfallId: 'r',
        name: 'Force of Will',
        quantity: 1,
        boardType: 'MAIN',
        rarity: 'rare',
      },
      ...enche(59, { rarity: 'common' }),
    ];
    expect(acharCodigo(cards, 'pauper', 'RARIDADE')?.mensagem).toMatch(/Force of Will/);
  });

  it('Pauper aceita deck só de comuns', () => {
    expect(acharCodigo(enche(60, { rarity: 'common' }), 'pauper', 'RARIDADE')).toBeUndefined();
  });

  it('PDH aplica o teto do DECK, não do comandante — o comandante é incomum de propósito', () => {
    const cards = [
      { ...comandanteLendario, rarity: 'uncommon' },
      ...enche(99, { rarity: 'common' }),
    ];
    expect(acharCodigo(cards, 'pdh', 'RARIDADE')).toBeUndefined();
    expect(acharCodigo(cards, 'pdh', 'RARIDADE_DO_COMANDANTE')).toBeUndefined();
  });

  it('Tiny Leaders acusa custo acima de 3', () => {
    const cards = [
      { ...comandanteLendario, cmc: 4 },
      { scryfallId: 'x', name: 'Griselbrand', quantity: 1, boardType: 'MAIN', cmc: 8 },
      ...enche(48, { cmc: 1 }),
    ];
    expect(acharCodigo(cards, 'tiny_leaders', 'VALOR_DE_MANA')?.mensagem).toMatch(/Griselbrand/);
  });
});

describe('legalidade — reserva', () => {
  it('acusa reserva acima de 15 no construído', () => {
    const cards = [
      ...enche(60),
      { scryfallId: 'res', name: 'Reserva', quantity: 20, boardType: 'SIDEBOARD' },
    ];
    const legal = avaliarLegalidade({ formatId: 'modern', cards });
    expect(legal.totalReserva).toBe(20);
    expect(legal.achados.find((a) => a.codigo === 'RESERVA')?.mensagem).toMatch(/até 15/);
  });

  it('reserva não conta no tamanho do deck', () => {
    const cards = [
      comandanteLendario,
      ...enche(99),
      { scryfallId: 'res', name: 'Reserva', quantity: 15, boardType: 'SIDEBOARD' },
    ];
    const legal = avaliarLegalidade({ formatId: 'commander', cards });
    expect(legal.total).toBe(100);
  });

  it('avisa que Commander não tem reserva', () => {
    const cards = [
      comandanteLendario,
      ...enche(99),
      { scryfallId: 'res', name: 'Reserva', quantity: 3, boardType: 'SIDEBOARD' },
    ];
    expect(acharCodigo(cards, 'commander', 'RESERVA')?.mensagem).toMatch(/não tem reserva/i);
  });
});

describe('legalidade — o bloqueio reporta o primeiro problema', () => {
  it('deck de 40 cartas sem comandante fala do TAMANHO', () => {
    // Erra nas duas coisas. A mensagem útil é a do tamanho: é o problema maior
    // e o que o jogador resolve primeiro.
    const motivo = motivoDeBloqueio({ formatId: 'commander', cards: enche(40) });
    expect(motivo).toMatch(/exatamente 100/i);
    expect(motivo).not.toMatch(/comandante/i);
  });

  it('deck completo sem comandante fala do COMANDANTE', () => {
    const motivo = motivoDeBloqueio({ formatId: 'commander', cards: enche(100) });
    expect(motivo).toMatch(/exige um comandante/i);
  });

  it('devolve null quando o deck pode entrar', () => {
    const cards = [comandanteLendario, ...enche(99)];
    expect(motivoDeBloqueio({ formatId: 'commander', cards })).toBeNull();
  });
});

describe('legalidade — contador desnormalizado', () => {
  it('avisa quando `cardCount` divergiu, mas valida pela soma real', () => {
    const cards = [comandanteLendario, ...enche(99)];
    const legal = avaliarLegalidade({ formatId: 'commander', cardCount: 97, cards });
    expect(legal.total).toBe(100);
    expect(legal.podeEntrarNaMesa).toBe(true);
    expect(legal.achados.find((a) => a.codigo === 'CONTADOR_DESSINCRONIZADO')).toBeDefined();
  });

  /**
   * O backend incrementa `cardCount` em TODA escrita de carta, inclusive na
   * reserva e no maybeboard. O aviso comparava o contador com as cartas que
   * jogam, e todo deck com reserva aparecia como "uma escrita falhou".
   */
  it('não acusa o contador de um deck com reserva e maybeboard — ele conta todos os boards', () => {
    const cards: CartaValidavel[] = [
      comandanteLendario,
      ...enche(99),
      { scryfallId: 'res', name: 'Reserva', boardType: 'SIDEBOARD', quantity: 10 },
      { scryfallId: 'talvez', name: 'Talvez', boardType: 'MAYBEBOARD', quantity: 5 },
    ];
    const legal = avaliarLegalidade({ formatId: 'commander', cardCount: 115, cards });
    expect(legal.total).toBe(100);
    expect(legal.achados.find((a) => a.codigo === 'CONTADOR_DESSINCRONIZADO')).toBeUndefined();
  });

  it('continua acusando quando a soma de todos os boards diverge', () => {
    const cards: CartaValidavel[] = [
      comandanteLendario,
      ...enche(99),
      { scryfallId: 'res', name: 'Reserva', boardType: 'SIDEBOARD', quantity: 10 },
    ];
    // 100 jogáveis + 10 na reserva = 110; um contador de 100 é o defeito real.
    const legal = avaliarLegalidade({ formatId: 'commander', cardCount: 100, cards });
    expect(legal.achados.find((a) => a.codigo === 'CONTADOR_DESSINCRONIZADO')?.mensagem).toMatch(
      /lista tem 110/,
    );
  });
});

/**
 * ─── AS CHAVES DE LEGALIDADE QUE A SCRYFALL TEM DE VERDADE ──────────────────
 *
 * Conferido na API em outubro de 2026: o Brawl de 60 cartas é `standardbrawl`,
 * `brawl` é o pool do Historic Brawl, e NÃO existem `historicbrawl` nem
 * `explorer`. Uma chave inexistente não dá erro nenhum — toda carta cai em
 * "sem legalities" e o formato simplesmente para de acusar banidas.
 */
describe('legalidade — a chave de cada formato existe na Scryfall', () => {
  /** Legalities reais da Scryfall para uma carta comum de comandante. */
  const cmdBrawl: CartaValidavel = {
    ...comandanteLendario,
    colorIdentity: [],
    legalities: { brawl: 'legal', standardbrawl: 'legal' },
  };

  it('Historic Brawl acusa banida pela chave `brawl` (Agent of Treachery)', () => {
    const cards: CartaValidavel[] = [
      cmdBrawl,
      ...enche(98),
      {
        name: 'Agent of Treachery',
        quantity: 1,
        boardType: 'MAIN',
        typeLine: 'Creature — Human Rogue',
        legalities: { brawl: 'banned', standardbrawl: 'not_legal', commander: 'legal' },
      },
    ];
    expect(acharCodigo(cards, 'historic_brawl', 'BANIDA')?.cartas).toEqual(['Agent of Treachery']);
  });

  it('Brawl (60, Standard) usa `standardbrawl`: Thoughtseize fica fora do pool', () => {
    const cards: CartaValidavel[] = [
      cmdBrawl,
      ...enche(58),
      {
        name: 'Thoughtseize',
        quantity: 1,
        boardType: 'MAIN',
        typeLine: 'Sorcery',
        legalities: { brawl: 'legal', standardbrawl: 'not_legal' },
      },
    ];
    expect(acharCodigo(cards, 'brawl', 'FORA_DO_FORMATO')?.cartas).toEqual(['Thoughtseize']);
  });

  it('Explorer valida pela chave de Pioneer: Sol Ring fica fora', () => {
    const solRing: CartaValidavel = {
      name: 'Sol Ring',
      quantity: 1,
      typeLine: 'Artifact',
      // Sem chave `explorer` — é exatamente a resposta atual da Scryfall.
      legalities: { pioneer: 'not_legal', commander: 'legal', vintage: 'restricted' },
    };
    expect(acharCodigo([...enche(59), solRing], 'explorer', 'FORA_DO_FORMATO')).toBeDefined();
  });

  it('nenhum formato do catálogo aponta para uma chave que a Scryfall não tem', () => {
    // As chaves que a Scryfall publica (out/2026). Um preset novo com chave
    // inventada deixaria o formato inteiro sem banlist, em silêncio.
    const CHAVES_DA_SCRYFALL = new Set([
      'standard',
      'future',
      'historic',
      'timeless',
      'gladiator',
      'pioneer',
      'modern',
      'legacy',
      'pauper',
      'vintage',
      'penny',
      'commander',
      'oathbreaker',
      'standardbrawl',
      'brawl',
      'alchemy',
      'paupercommander',
      'duel',
      'oldschool',
      'premodern',
      'predh',
    ]);
    const invalidas = FORMATOS.filter(
      (f) => f.deck.chaveDeLegalidade !== null && !CHAVES_DA_SCRYFALL.has(f.deck.chaveDeLegalidade),
    ).map((f) => `${f.id}→${f.deck.chaveDeLegalidade}`);
    expect(invalidas).toEqual([]);
  });
});

describe('legalidade — Canadian Highlander é mínimo de 100, não exato', () => {
  it('101 cartas não é erro de tamanho', () => {
    const legal = avaliarLegalidade({ formatId: 'canlander', cards: enche(101) });
    expect(legal.achados.find((a) => a.codigo === 'TAMANHO')).toBeUndefined();
    expect(legal.podeEntrarNaMesa).toBe(true);
  });

  it('99 cartas continua sendo', () => {
    expect(acharCodigo(enche(99), 'canlander', 'TAMANHO')?.mensagem).toMatch(/no mínimo 100/i);
  });
});

describe('legalidade — o deck construído inclui a reserva (CR 100.4a)', () => {
  const bolt = (quantity: number, boardType: string): CartaValidavel => ({
    scryfallId: `bolt-${boardType}`,
    name: 'Lightning Bolt',
    typeLine: 'Instant',
    quantity,
    boardType,
  });

  it('4 no main + 2 na reserva passa do limite de 4 cópias', () => {
    const cards = [...enche(56), bolt(4, 'MAIN'), bolt(2, 'SIDEBOARD')];
    expect(acharCodigo(cards, 'modern', 'COPIAS')?.mensagem).toMatch(/Lightning Bolt \(6\)/);
  });

  it('3 no main + 1 na reserva continua legal', () => {
    const cards = [...enche(57), bolt(3, 'MAIN'), bolt(1, 'SIDEBOARD')];
    expect(acharCodigo(cards, 'modern', 'COPIAS')).toBeUndefined();
  });

  it('banida na RESERVA também bloqueia — ela entra na partida na troca', () => {
    const cards: CartaValidavel[] = [
      ...enche(60),
      {
        name: 'Ragavan, Nimble Pilferer',
        quantity: 1,
        boardType: 'SIDEBOARD',
        typeLine: 'Legendary Creature — Monkey Pirate',
        legalities: { modern: 'banned' },
      },
    ];
    const legal = avaliarLegalidade({ formatId: 'modern', cards });
    expect(legal.achados.find((a) => a.codigo === 'BANIDA')?.cartas).toEqual([
      'Ragavan, Nimble Pilferer',
    ]);
    expect(legal.podeEntrarNaMesa).toBe(false);
  });

  it('em Commander, a reserva é anotação: uma banida lá não bloqueia a mesa', () => {
    // Formato sem reserva: o que está nela não entra na partida.
    const cards: CartaValidavel[] = [
      comandanteLendario,
      ...enche(99),
      {
        name: 'Mana Crypt',
        quantity: 1,
        boardType: 'SIDEBOARD',
        typeLine: 'Artifact',
        legalities: { commander: 'banned' },
      },
    ];
    expect(acharCodigo(cards, 'commander', 'BANIDA')).toBeUndefined();
  });

  it('restrita em duas impressões (1 + 1) é acusada no Vintage', () => {
    const lotus = {
      name: 'Black Lotus',
      quantity: 1,
      boardType: 'MAIN',
      typeLine: 'Artifact',
      legalities: { vintage: 'restricted' },
    };
    const cards = [...enche(58), { ...lotus, scryfallId: 'lea' }, { ...lotus, scryfallId: 'leb' }];
    const achado = acharCodigo(cards, 'vintage', 'RESTRITA');
    expect(achado?.mensagem).toMatch(/Black Lotus \(2\)/);
    // Uma entrada por NOME, não por impressão.
    expect(achado?.cartas).toEqual(['Black Lotus']);
  });

  it('uma única cópia de restrita continua legal', () => {
    const lotus: CartaValidavel = {
      name: 'Black Lotus',
      quantity: 1,
      typeLine: 'Artifact',
      legalities: { vintage: 'restricted' },
    };
    expect(acharCodigo([...enche(59), lotus], 'vintage', 'RESTRITA')).toBeUndefined();
  });
});

describe('legalidade — o comandante que cada formato aceita', () => {
  it('Brawl aceita planeswalker lendário como comandante', () => {
    const jace: CartaValidavel = {
      ...comandanteLendario,
      name: 'Jace, Wielder of Mysteries',
      typeLine: 'Legendary Planeswalker — Jace',
      colorIdentity: ['U'],
    };
    expect(acharCodigo([jace, ...enche(59)], 'brawl', 'TIPO_DE_COMANDANTE')).toBeUndefined();
    expect(
      acharCodigo([jace, ...enche(99)], 'historic_brawl', 'TIPO_DE_COMANDANTE'),
    ).toBeUndefined();
  });

  it('Commander continua avisando sobre planeswalker sem "pode ser seu comandante"', () => {
    const jace: CartaValidavel = {
      ...comandanteLendario,
      typeLine: 'Legendary Planeswalker — Jace',
    };
    expect(acharCodigo([jace, ...enche(99)], 'commander', 'TIPO_DE_COMANDANTE')).toBeDefined();
  });

  it('PDH aceita criatura incomum NÃO lendária como comandante', () => {
    const murasa: CartaValidavel = {
      ...comandanteLendario,
      name: 'Murasa Rootgrazer',
      typeLine: 'Creature — Elemental',
      rarity: 'uncommon',
      colorIdentity: ['G', 'W'],
    };
    const legal = avaliarLegalidade({ formatId: 'pdh', cards: [murasa, ...enche(99)] });
    expect(legal.achados.find((a) => a.codigo === 'TIPO_DE_COMANDANTE')).toBeUndefined();
  });

  it('PDH ainda avisa quando o comandante não é criatura', () => {
    const feitico: CartaValidavel = {
      ...comandanteLendario,
      name: 'Lightning Bolt',
      typeLine: 'Instant',
      rarity: 'uncommon',
    };
    expect(acharCodigo([feitico, ...enche(99)], 'pdh', 'TIPO_DE_COMANDANTE')).toBeDefined();
  });

  it('PDH não acusa o comandante de fora do pool — `paupercommander` descreve as 99', () => {
    const tatyova: CartaValidavel = {
      ...comandanteLendario,
      name: 'Tatyova, Benthic Druid',
      typeLine: 'Legendary Creature — Merfolk Druid',
      rarity: 'uncommon',
      colorIdentity: ['G', 'U'],
      legalities: { paupercommander: 'not_legal' },
    };
    const cards = [tatyova, ...enche(99, { legalities: { paupercommander: 'legal' } })];
    expect(acharCodigo(cards, 'pdh', 'FORA_DO_FORMATO')).toBeUndefined();
  });

  it('PDH continua acusando uma carta das 99 fora do pool', () => {
    const cards: CartaValidavel[] = [
      { ...comandanteLendario, rarity: 'uncommon' },
      ...enche(98, { legalities: { paupercommander: 'legal' } }),
      {
        name: 'Sol Ring',
        quantity: 1,
        typeLine: 'Artifact',
        legalities: { paupercommander: 'not_legal' },
      },
    ];
    expect(acharCodigo(cards, 'pdh', 'FORA_DO_FORMATO')?.cartas).toEqual(['Sol Ring']);
  });
});

describe('legalidade — raridade de Pauper é de QUALQUER impressão', () => {
  it('Counterspell de MH2 (incomum) com pauper=legal não é acusado', () => {
    const counterspell: CartaValidavel = {
      name: 'Counterspell',
      quantity: 1,
      typeLine: 'Instant',
      rarity: 'uncommon',
      legalities: { pauper: 'legal' },
    };
    expect(acharCodigo([...enche(59), counterspell], 'pauper', 'RARIDADE')).toBeUndefined();
  });

  it('sem a legalidade da Scryfall, a raridade da impressão continua valendo', () => {
    // Recuo: hidratação parcial não pode transformar "não sei" em "legal".
    const rara: CartaValidavel = { name: 'Rara', quantity: 1, typeLine: 'Instant', rarity: 'rare' };
    expect(acharCodigo([...enche(59), rara], 'pauper', 'RARIDADE')).toBeDefined();
  });
});

describe('formato — PDH começa com 30 de vida', () => {
  it('as regras oficiais são 30 de vida, não os 40 de Commander', () => {
    expect(acharFormato('pdh').vidaInicial).toBe(30);
  });
});
