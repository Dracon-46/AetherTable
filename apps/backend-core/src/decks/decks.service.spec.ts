/**
 * decks.service.spec.ts — o que o deckbuilder escreve no banco.
 *
 * ─── POR QUE UM BANCO FALSO COM ESTADO, E NÃO SÓ `jest.fn()` ────────────────
 *
 * Metade dos defeitos aqui é de CONSISTÊNCIA: o contador `cardCount` divergindo
 * da soma das linhas, uma quantidade perdida entre dois cliques, uma linha
 * duplicada batendo na chave única. Um duplo que só devolve valores fixos não
 * enxerga nada disso — ele confirma que o código chamou o que chamou.
 *
 * O falso abaixo guarda as linhas, aplica `increment` como o Postgres, recusa a
 * chave única duplicada com o mesmo P2002 do Prisma e DESFAZ a transação quando
 * ela lança. É pequeno de propósito: só o que `DecksService` usa. Nada aqui
 * toca o banco de verdade.
 */

import { BadRequestException } from '@nestjs/common';
import { BoardType, Prisma } from '@prisma/client';
import { DecksService } from './decks.service.js';

const USUARIO = '0b6c1f9e-3a5d-4c2b-9e8f-1a2b3c4d5e6f';
const DECK = '7d2e8a10-4b6c-4f1e-9a3b-2c5d7e9f1a2b';

/** Ids de impressão realistas (UUID da Scryfall, em minúsculas). */
const SOL_RING = '6ad8011d-3471-4369-9d68-b264cc027487';
const FOREST_ZNR = 'b2d1a5a5-8a5e-4f5a-9b38-4f7f2d6f0f0a';
const FOREST_M21 = 'c3e2b6b6-9b6f-4a6b-8c49-5a8a3e7a1b1b';

type Linha = {
  id: string;
  deckId: string;
  scryfallId: string;
  quantity: number;
  boardType: BoardType;
};

const erroDoPrisma = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(`falso ${code}`, { code, clientVersion: 'teste' });

function bancoFalso(inicial: Omit<Linha, 'deckId'>[] = [], formatId = 'commander') {
  let linhas = new Map<string, Linha>(inicial.map((l) => [l.id, { ...l, deckId: DECK }]));
  const deck = {
    id: DECK,
    userId: USUARIO,
    name: 'Dinossauros',
    description: null as string | null,
    formatId,
    commanderId: null as string | null,
    partnerId: null as string | null,
    colorIdentity: [] as string[],
    isFavorite: false,
    isPublic: false,
    cardCount: inicial.reduce((s, l) => s + l.quantity, 0),
  };
  const criados: Array<Record<string, unknown>> = [];
  let sequencia = 0;

  const porChave = (w: { deckId: string; scryfallId: string; boardType: BoardType }) =>
    [...linhas.values()].find(
      (l) => l.deckId === w.deckId && l.scryfallId === w.scryfallId && l.boardType === w.boardType,
    );
  const aplicar = (atual: number, q: number | { increment: number }) =>
    typeof q === 'number' ? q : atual + q.increment;
  const inserir = (dados: Omit<Linha, 'id'>) => {
    if (porChave(dados)) throw erroDoPrisma('P2002');
    const nova = { id: `linha-${(sequencia += 1)}`, ...dados };
    linhas.set(nova.id, nova);
    return { ...nova };
  };

  const prisma = {
    deck: {
      findFirst: jest.fn(async (args?: { include?: { cards?: boolean } }) => ({
        ...deck,
        ...(args?.include?.cards ? { cards: [...linhas.values()].map((l) => ({ ...l })) } : {}),
      })),
      update: jest.fn(
        async ({
          data,
        }: {
          data: { cardCount?: number | Record<string, number> } & Record<string, unknown>;
        }) => {
          const { cardCount: c, ...resto } = data;
          // Campos que não são o contador (nome, favorito, resumo) entram como
          // vieram — é o que o Prisma faz com um valor absoluto.
          Object.assign(deck, resto);
          if (typeof c === 'number') deck.cardCount = c;
          else if (c?.['increment'] !== undefined) deck.cardCount += c['increment'];
          else if (c?.['decrement'] !== undefined) deck.cardCount -= c['decrement'];
          return { ...deck };
        },
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const novo = { id: `deck-novo-${criados.length + 1}`, ...data };
        criados.push(novo);
        return { ...novo };
      }),
    },
    deckCard: {
      findUnique: jest.fn(
        async ({ where }: { where: { id?: string; deckId_scryfallId_boardType?: Linha } }) => {
          const l = where.id ? linhas.get(where.id) : porChave(where.deckId_scryfallId_boardType!);
          return l ? { ...l } : null;
        },
      ),
      findFirst: jest.fn(async ({ where }: { where: Partial<Linha> }) => {
        const l = [...linhas.values()].find(
          (x) =>
            (where.id === undefined || x.id === where.id) &&
            (where.deckId === undefined || x.deckId === where.deckId) &&
            (where.scryfallId === undefined || x.scryfallId === where.scryfallId) &&
            (where.boardType === undefined || x.boardType === where.boardType),
        );
        return l ? { ...l } : null;
      }),
      create: jest.fn(async ({ data }: { data: Omit<Linha, 'id'> }) => inserir(data)),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Omit<Linha, 'quantity'>> & { quantity?: number | { increment: number } };
        }) => {
          const l = linhas.get(where.id);
          if (!l) throw erroDoPrisma('P2025');
          const proxima = {
            ...l,
            ...(data.scryfallId ? { scryfallId: data.scryfallId } : {}),
            ...(data.boardType ? { boardType: data.boardType } : {}),
          };
          const colide = porChave(proxima);
          if (colide && colide.id !== l.id) throw erroDoPrisma('P2002');
          if (data.quantity !== undefined) proxima.quantity = aplicar(l.quantity, data.quantity);
          linhas.set(l.id, proxima);
          return { ...proxima };
        },
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { deckId_scryfallId_boardType: Linha };
          create: Omit<Linha, 'id'>;
          update: { quantity: { increment: number } };
        }) => {
          const l = porChave(where.deckId_scryfallId_boardType);
          if (!l) return inserir(create);
          l.quantity = aplicar(l.quantity, update.quantity);
          return { ...l };
        },
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const l = linhas.get(where.id);
        if (!l) throw erroDoPrisma('P2025');
        linhas.delete(where.id);
        return { ...l };
      }),
      deleteMany: jest.fn(async ({ where }: { where: { deckId: string } }) => {
        for (const [id, l] of linhas) if (l.deckId === where.deckId) linhas.delete(id);
        return { count: 0 };
      }),
      createMany: jest.fn(async ({ data }: { data: Omit<Linha, 'id'>[] }) => {
        for (const d of data) inserir(d);
        return { count: data.length };
      }),
    },
    /**
     * As duas formas do Prisma: a lista de promessas (que já executaram — é
     * como o código antigo usava) e a função interativa, que DESFAZ tudo se
     * lançar. Sem o desfazer, um teste de teto passaria com a linha já
     * gravada acima do limite.
     */
    $transaction: jest.fn(async (arg: unknown): Promise<unknown> => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const copia = new Map([...linhas].map(([k, v]) => [k, { ...v }]));
      const contador = deck.cardCount;
      try {
        return await (arg as (tx: unknown) => Promise<unknown>)(transacao);
      } catch (erro) {
        linhas = copia;
        deck.cardCount = contador;
        throw erro;
      }
    }),
  };
  // A transação recebe o próprio falso como `tx`, como o Prisma faz.
  const transacao: unknown = prisma;

  return {
    prisma,
    deck,
    criados,
    linhas: () => [...linhas.values()],
    soma: () => [...linhas.values()].reduce((s, l) => s + l.quantity, 0),
  };
}

function montar(banco: ReturnType<typeof bancoFalso>, scryfall: object[] = []) {
  const cards = { collection: jest.fn().mockResolvedValue({ data: scryfall, not_found: [] }) };
  const svc = new DecksService(banco.prisma as never, cards as never);
  return { svc, cards };
}

describe('DecksService — quantidade escrita de forma relativa (cardCount consistente)', () => {
  it('usa `increment`, e não um valor absoluto calculado fora da transação', async () => {
    const banco = bancoFalso([{ id: 'l1', scryfallId: SOL_RING, quantity: 3, boardType: 'MAIN' }]);
    const { svc } = montar(banco);

    await svc.updateCardQuantity(USUARIO, DECK, 'l1', 1);

    expect(banco.prisma.deckCard.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quantity: { increment: 1 } } }),
    );
  });

  it('dois +1 simultâneos somam 2 — e o contador concorda com as linhas', async () => {
    const banco = bancoFalso([{ id: 'l1', scryfallId: SOL_RING, quantity: 3, boardType: 'MAIN' }]);
    const { svc } = montar(banco);

    // O código antigo lia 3 nas duas chamadas e gravava 4 duas vezes, enquanto
    // o contador (relativo) subia para 5.
    await Promise.all([
      svc.updateCardQuantity(USUARIO, DECK, 'l1', 1),
      svc.updateCardQuantity(USUARIO, DECK, 'l1', 1),
    ]);

    expect(banco.linhas()[0]?.quantity).toBe(5);
    expect(banco.deck.cardCount).toBe(banco.soma());
  });

  it('chegar a zero apaga a linha e desconta do contador o que ela tinha', async () => {
    const banco = bancoFalso([
      { id: 'l1', scryfallId: SOL_RING, quantity: 2, boardType: 'MAIN' },
      { id: 'l2', scryfallId: FOREST_ZNR, quantity: 30, boardType: 'MAIN' },
    ]);
    const { svc } = montar(banco);

    await svc.updateCardQuantity(USUARIO, DECK, 'l1', -5);

    expect(banco.linhas().map((l) => l.id)).toEqual(['l2']);
    expect(banco.deck.cardCount).toBe(30);
  });

  it('remover desconta a quantidade que a linha tinha NA HORA de apagar', async () => {
    const banco = bancoFalso([{ id: 'l1', scryfallId: SOL_RING, quantity: 4, boardType: 'MAIN' }]);
    const { svc } = montar(banco);

    // Um +1 de outra aba chega entre a leitura e a remoção. Descontando os 4
    // lidos antes, o contador terminava em 1 com o deck vazio.
    await Promise.all([
      svc.updateCardQuantity(USUARIO, DECK, 'l1', 1),
      svc.removeCard(USUARIO, DECK, 'l1'),
    ]);

    expect(banco.linhas()).toEqual([]);
    expect(banco.deck.cardCount).toBe(0);
  });

  it('addCard soma na linha existente com upsert + increment', async () => {
    const banco = bancoFalso([{ id: 'l1', scryfallId: SOL_RING, quantity: 1, boardType: 'MAIN' }]);
    const { svc } = montar(banco);

    await svc.addCard(USUARIO, DECK, SOL_RING, 2, BoardType.MAIN);

    expect(banco.prisma.deckCard.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deckId_scryfallId_boardType: { deckId: DECK, scryfallId: SOL_RING, boardType: 'MAIN' },
        },
        update: { quantity: { increment: 2 } },
      }),
    );
    expect(banco.linhas()[0]?.quantity).toBe(3);
    expect(banco.deck.cardCount).toBe(3);
  });

  it('dois "adicionar" simultâneos da mesma carta não estouram a chave única', async () => {
    const banco = bancoFalso();
    const { svc } = montar(banco);

    await Promise.all([
      svc.addCard(USUARIO, DECK, SOL_RING, 1, BoardType.MAIN),
      svc.addCard(USUARIO, DECK, SOL_RING, 1, BoardType.MAIN),
    ]);

    expect(banco.linhas()).toHaveLength(1);
    expect(banco.linhas()[0]?.quantity).toBe(2);
    expect(banco.deck.cardCount).toBe(2);
  });
});

describe('DecksService — teto de 99 cópias por carta', () => {
  it('+99 sobre 99 é recusado, e nada muda', async () => {
    const banco = bancoFalso([
      { id: 'l1', scryfallId: FOREST_ZNR, quantity: 99, boardType: 'MAIN' },
    ]);
    const { svc } = montar(banco);

    await expect(svc.updateCardQuantity(USUARIO, DECK, 'l1', 99)).rejects.toThrow(
      new BadRequestException('Máximo de 99 cópias por carta'),
    );
    expect(banco.linhas()[0]?.quantity).toBe(99);
    expect(banco.deck.cardCount).toBe(99);
  });

  it('adicionar 1 a uma linha de 99 é recusado', async () => {
    const banco = bancoFalso([
      { id: 'l1', scryfallId: FOREST_ZNR, quantity: 99, boardType: 'MAIN' },
    ]);
    const { svc } = montar(banco);

    await expect(svc.addCard(USUARIO, DECK, FOREST_ZNR, 1, BoardType.MAIN)).rejects.toThrow(
      /Máximo de 99 cópias/,
    );
    expect(banco.linhas()[0]?.quantity).toBe(99);
    expect(banco.deck.cardCount).toBe(99);
  });
});

describe('DecksService — scryfallId em maiúsculas', () => {
  it('addCard grava em minúsculas: a mesma carta não vira duas linhas', async () => {
    const banco = bancoFalso([{ id: 'l1', scryfallId: SOL_RING, quantity: 1, boardType: 'MAIN' }]);
    const { svc } = montar(banco);

    await svc.addCard(USUARIO, DECK, SOL_RING.toUpperCase(), 1, BoardType.MAIN);

    expect(banco.linhas()).toHaveLength(1);
    expect(banco.linhas()[0]?.quantity).toBe(2);
  });

  it('a hidratação casa a linha em maiúsculas e marca a banida', async () => {
    const banco = bancoFalso([
      { id: 'l1', scryfallId: SOL_RING.toUpperCase(), quantity: 1, boardType: 'MAIN' },
    ]);
    const { svc } = montar(banco, [
      {
        id: SOL_RING,
        name: 'Sol Ring',
        set: 'c21',
        type_line: 'Artifact',
        legalities: { commander: 'banned' },
      },
    ]);

    const deck = (await svc.getDeckById(USUARIO, DECK)) as unknown as {
      cards: { name: string; isBanned: boolean }[];
    };
    expect(deck.cards[0]).toMatchObject({ name: 'Sol Ring', isBanned: true });
  });
});

describe('DecksService — isBanned lê a chave de legalidade do formato', () => {
  const comLegalidade = (legalities: Record<string, string>) => [
    { id: SOL_RING, name: 'Sol Ring', set: 'c21', type_line: 'Artifact', legalities },
  ];

  it.each([
    ['duel_commander', { commander: 'legal', duel: 'banned' }],
    ['pdh', { commander: 'legal', paupercommander: 'banned' }],
    ['historic_brawl', { commander: 'legal', brawl: 'banned' }],
    ['commander_1v1', { commander: 'banned' }],
  ])('%s marca a banida pela chave do formato, não pelo id', async (formato, legalities) => {
    // `legalities[formatId]` não existe para nenhum destes ids: a banida
    // passava como legal e o deck entrava na mesa com ela.
    const banco = bancoFalso(
      [{ id: 'l1', scryfallId: SOL_RING, quantity: 1, boardType: 'MAIN' }],
      formato,
    );
    const { svc } = montar(banco, comLegalidade(legalities));

    const deck = (await svc.getDeckById(USUARIO, DECK)) as unknown as {
      cards: { isBanned: boolean }[];
    };
    expect(deck.cards[0]?.isBanned).toBe(true);
  });

  it('formato sem banlist (freeform) não marca nada', async () => {
    const banco = bancoFalso(
      [{ id: 'l1', scryfallId: SOL_RING, quantity: 1, boardType: 'MAIN' }],
      'freeform',
    );
    const { svc } = montar(banco, comLegalidade({ commander: 'banned', freeform: 'banned' }));

    const deck = (await svc.getDeckById(USUARIO, DECK)) as unknown as {
      cards: { isBanned: boolean }[];
    };
    expect(deck.cards[0]?.isBanned).toBe(false);
  });
});

describe('DecksService — mover para onde a carta já está junta as cópias', () => {
  it('mover para a reserva uma carta que já está lá soma as quantidades', async () => {
    const banco = bancoFalso([
      { id: 'main', scryfallId: SOL_RING, quantity: 2, boardType: 'MAIN' },
      { id: 'res', scryfallId: SOL_RING, quantity: 1, boardType: 'SIDEBOARD' },
    ]);
    const { svc } = montar(banco);

    // O `update` direto batia na chave única e a rota respondia 500.
    await svc.updateBoardType(USUARIO, DECK, 'main', BoardType.SIDEBOARD);

    expect(banco.linhas()).toEqual([
      expect.objectContaining({ id: 'res', boardType: 'SIDEBOARD', quantity: 3 }),
    ]);
    expect(banco.deck.cardCount).toBe(3);
  });

  it('trocar para uma impressão que o deck já usa soma as quantidades', async () => {
    const banco = bancoFalso([
      { id: 'znr', scryfallId: FOREST_ZNR, quantity: 4, boardType: 'MAIN' },
      { id: 'm21', scryfallId: FOREST_M21, quantity: 6, boardType: 'MAIN' },
    ]);
    const { svc } = montar(banco);

    await svc.updatePrinting(USUARIO, DECK, 'znr', FOREST_M21.toUpperCase());

    expect(banco.linhas()).toEqual([
      expect.objectContaining({ id: 'm21', scryfallId: FOREST_M21, quantity: 10 }),
    ]);
    expect(banco.deck.cardCount).toBe(10);
  });

  it('sem colisão, só muda o board', async () => {
    const banco = bancoFalso([{ id: 'l1', scryfallId: SOL_RING, quantity: 1, boardType: 'MAIN' }]);
    const { svc } = montar(banco);

    await svc.updateBoardType(USUARIO, DECK, 'l1', BoardType.MAYBEBOARD);

    expect(banco.linhas()).toEqual([
      expect.objectContaining({ id: 'l1', boardType: 'MAYBEBOARD' }),
    ]);
  });

  it('juntar acima de 99 é recusado e nada muda', async () => {
    const banco = bancoFalso([
      { id: 'a', scryfallId: FOREST_ZNR, quantity: 60, boardType: 'MAIN' },
      { id: 'b', scryfallId: FOREST_ZNR, quantity: 50, boardType: 'SIDEBOARD' },
    ]);
    const { svc } = montar(banco);

    await expect(
      svc.updateBoardType(USUARIO, DECK, 'a', BoardType.SIDEBOARD),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(banco.linhas().map((l) => [l.id, l.quantity])).toEqual([
      ['a', 60],
      ['b', 50],
    ]);
  });
});

describe('DecksService — importação de lista', () => {
  const carta = (id: string, name: string, set: string) => ({ id, name, set, type_line: '' });

  it('as cartas depois de "Sideboard" são gravadas na reserva', async () => {
    const banco = bancoFalso();
    const { svc } = montar(banco, [
      carta(SOL_RING, 'Sol Ring', 'c21'),
      carta(FOREST_ZNR, 'Forest', 'znr'),
    ]);

    await svc.importDeckList(USUARIO, DECK, '1 Sol Ring\nSideboard\n2 Forest');

    expect(banco.linhas()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scryfallId: SOL_RING, boardType: 'MAIN', quantity: 1 }),
        expect.objectContaining({ scryfallId: FOREST_ZNR, boardType: 'SIDEBOARD', quantity: 2 }),
      ]),
    );
  });

  it('"Commander" é zona de comando, e nenhum cabeçalho vai à Scryfall', async () => {
    const banco = bancoFalso();
    const { svc, cards } = montar(banco, [carta(SOL_RING, 'Sol Ring', 'c21')]);

    await svc.importDeckList(USUARIO, DECK, 'Commander\n1 Sol Ring\nDeck\nSideboard');

    const nomesPedidos = (cards.collection.mock.calls[0]![0] as { name: string }[]).map(
      (p) => p.name,
    );
    expect(nomesPedidos).toEqual(['Sol Ring']);
    expect(banco.linhas()[0]?.boardType).toBe('COMMANDER');
  });

  it('"4 Forest (ZNR)" + "6 Forest (M21)" grava 4 + 6, e não 4 + 4', async () => {
    const banco = bancoFalso();
    const { svc } = montar(banco, [
      carta(FOREST_M21, 'Forest', 'm21'),
      carta(FOREST_ZNR, 'Forest', 'znr'),
    ]);

    await svc.importDeckList(USUARIO, DECK, '4 Forest (ZNR)\n6 Forest (M21)');

    const porId = Object.fromEntries(banco.linhas().map((l) => [l.scryfallId, l.quantity]));
    expect(porId).toEqual({ [FOREST_ZNR]: 4, [FOREST_M21]: 6 });
    expect(banco.deck.cardCount).toBe(10);
  });

  it('a mesma impressão em duas linhas não derruba o import com a chave única', async () => {
    const banco = bancoFalso();
    const { svc } = montar(banco, [carta(SOL_RING, 'Sol Ring', 'c21')]);

    await expect(
      svc.importDeckList(USUARIO, DECK, '1 Sol Ring (C21)\n1 Sol Ring (C21)'),
    ).resolves.toMatchObject({ success: true });
    expect(banco.linhas()).toEqual([expect.objectContaining({ quantity: 2 })]);
  });

  it('o nome vai à Scryfall sem a categoria do Archidekt nem o foil do Moxfield', async () => {
    const banco = bancoFalso();
    const { svc, cards } = montar(banco, [carta(SOL_RING, 'Sol Ring', 'c21')]);

    await svc.importDeckList(USUARIO, DECK, '1x Sol Ring (c21) 263 [Ramp,Artifact] *F*');

    expect(cards.collection.mock.calls[0]![0]).toEqual([{ name: 'Sol Ring', set: 'c21' }]);
    expect(banco.linhas()).toHaveLength(1);
  });

  it('2000000000 cópias não chegam ao banco', async () => {
    const banco = bancoFalso();
    const { svc } = montar(banco, [carta(FOREST_ZNR, 'Forest', 'znr')]);

    const r = await svc.importDeckList(USUARIO, DECK, '2000000000 Forest');

    expect(banco.linhas()).toEqual([]);
    expect(r.notFound[0]).toMatch(/fora de 1–99/);
  });
});

describe('DecksService — clonar, atualizar em parte e o resumo da lista', () => {
  it('clonar copia cada linha com a mesma impressão e o mesmo contador, num deck privado', async () => {
    const banco = bancoFalso([
      { id: 'l1', scryfallId: 'sf-cmd', quantity: 1, boardType: BoardType.COMMANDER },
      { id: 'l2', scryfallId: 'sf-a', quantity: 1, boardType: BoardType.MAIN },
      { id: 'l3', scryfallId: 'sf-b', quantity: 4, boardType: BoardType.SIDEBOARD },
    ]);
    const { svc } = montar(banco);

    const novo = (await svc.clonarDeck(USUARIO, DECK)) as { id: string; name: string };

    expect(novo.name).toBe('Dinossauros (cópia)');
    expect(banco.criados[0]).toMatchObject({ cardCount: 6 });
    expect(banco.criados[0]).not.toHaveProperty('isPublic', true);
    const copiadas = banco.linhas().filter((l) => l.deckId === novo.id);
    expect(copiadas.map((l) => [l.scryfallId, l.quantity, l.boardType]).sort()).toEqual(
      [
        ['sf-a', 1, BoardType.MAIN],
        ['sf-b', 4, BoardType.SIDEBOARD],
        ['sf-cmd', 1, BoardType.COMMANDER],
      ].sort(),
    );
  });

  it('atualizar só o favorito não mexe no nome', async () => {
    const banco = bancoFalso();
    const { svc } = montar(banco);

    await svc.updateDeck(USUARIO, DECK, { isFavorite: true });

    expect(banco.deck.isFavorite).toBe(true);
    expect(banco.deck.name).toBe('Dinossauros');
  });

  it('abrir o deck grava comandante e identidade de cor — e só quando mudou', async () => {
    const banco = bancoFalso([
      { id: 'l1', scryfallId: 'sf-cmd', quantity: 1, boardType: BoardType.COMMANDER },
      { id: 'l2', scryfallId: 'sf-a', quantity: 1, boardType: BoardType.MAIN },
    ]);
    const { svc } = montar(banco, [
      { id: 'sf-cmd', name: 'Pantlaza', set: 'lcc', color_identity: ['G', 'R', 'W'] },
      { id: 'sf-a', name: 'Forest', set: 'lcc', color_identity: ['G'] },
    ]);

    await svc.getDeckById(USUARIO, DECK);
    expect(banco.deck.commanderId).toBe('sf-cmd');
    // Na ordem WUBRG, não na ordem em que a Scryfall mandou.
    expect(banco.deck.colorIdentity).toEqual(['W', 'R', 'G']);

    banco.prisma.deck.update.mockClear();
    await svc.getDeckById(USUARIO, DECK);
    // `updatedAt` é @updatedAt: regravar o mesmo resumo reordenaria a lista.
    expect(banco.prisma.deck.update).not.toHaveBeenCalled();
  });
});
