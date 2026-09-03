import {
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
});
