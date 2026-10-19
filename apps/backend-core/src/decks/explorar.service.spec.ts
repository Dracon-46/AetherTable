/**
 * explorar.service.spec.ts — curtir, ver e copiar decks públicos.
 *
 * O que estes casos fixam:
 *
 *   - curtir duas vezes conta UMA curtida (a chave composta decide), e o
 *     contador só anda quando a curtida de fato nasce ou morre;
 *   - deck privado (ou de conta excluída) é 404, igual a deck inexistente —
 *     a rota não pode confirmar que um id alheio existe;
 *   - a cópia nasce PRIVADA, na conta de quem copiou, com as mesmas linhas.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExplorarService } from './explorar.service.js';
import { MAXIMO_DE_DECKS_POR_CONTA } from './limites-de-conta.js';

const DONO = 'dono-1';
const EU = 'eu-1';
const DECK = 'deck-1';

function bancoFalso(opcoes: { publico?: boolean } = {}) {
  const publico = opcoes.publico ?? true;
  let likes = new Set<string>();
  const deck = { id: DECK, userId: DONO, likeCount: 0 };
  const criados: Record<string, unknown>[] = [];
  const linhasCriadas: Record<string, unknown>[] = [];

  // A transação recebe o próprio falso como `tx`, como o Prisma faz. Declarado
  // antes para o tipo do objeto não depender dele mesmo.
  const ref: { tx?: unknown } = {};
  const prisma = {
    deck: {
      findFirst: jest.fn(async () =>
        publico ? { id: DECK, userId: DONO, user: { username: 'gaspare' } } : null,
      ),
      findUnique: jest.fn(async (args: { include?: { cards?: boolean } }) => ({
        ...deck,
        name: 'Dinossauros',
        description: 'Ramp e dinos',
        formatId: 'commander',
        commanderId: 'sf-cmd',
        partnerId: null,
        colorIdentity: ['W', 'R', 'G'],
        cardCount: 2,
        ...(args?.include?.cards
          ? {
              cards: [
                { scryfallId: 'sf-cmd', quantity: 1, boardType: 'COMMANDER' },
                { scryfallId: 'sf-a', quantity: 1, boardType: 'MAIN' },
              ],
            }
          : {}),
      })),
      update: jest.fn(async ({ data }: { data: { likeCount: Record<string, number> } }) => {
        if (data.likeCount.increment) deck.likeCount += data.likeCount.increment;
        if (data.likeCount.decrement) deck.likeCount -= data.likeCount.decrement;
        return { likeCount: deck.likeCount };
      }),
      // Decks de quem copia. Um só por padrão; o teste de teto sobe o número.
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const novo = { id: 'deck-novo', ...data };
        criados.push(novo);
        return novo;
      }),
    },
    deckLike: {
      createMany: jest.fn(async ({ data }: { data: { userId: string }[] }) => {
        const antes = likes.size;
        for (const d of data) likes.add(d.userId);
        return { count: likes.size - antes };
      }),
      deleteMany: jest.fn(async ({ where }: { where: { userId: string } }) => {
        const tinha = likes.delete(where.userId);
        return { count: tinha ? 1 : 0 };
      }),
      findUnique: jest.fn(async () => null),
    },
    deckCard: {
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        linhasCriadas.push(...data);
        return { count: data.length };
      }),
    },
    $transaction: jest.fn(async (arg: unknown): Promise<unknown> => {
      if (Array.isArray(arg)) return Promise.all(arg);
      const copia = new Set(likes);
      const contador = deck.likeCount;
      try {
        return await (arg as (tx: unknown) => Promise<unknown>)(ref.tx);
      } catch (erro) {
        likes = copia;
        deck.likeCount = contador;
        throw erro;
      }
    }),
  };

  ref.tx = prisma;
  // O deck como `getDeckById` o devolve: com a pasta e o favorito do DONO.
  const decks = {
    getDeckById: jest.fn(async () => ({
      id: DECK,
      userId: DONO,
      folder: 'Proxies para testar',
      isFavorite: true,
      cards: [],
    })),
  };
  const svc = new ExplorarService(prisma as never, decks as never);
  return { svc, prisma, deck, criados, linhasCriadas, curtidas: () => likes.size };
}

describe('ExplorarService.curtir', () => {
  it('curtir duas vezes conta uma curtida só', async () => {
    const banco = bancoFalso();
    await banco.svc.curtir(EU, DECK, true);
    const segunda = await banco.svc.curtir(EU, DECK, true);

    expect(banco.curtidas()).toBe(1);
    expect(segunda.likeCount).toBe(1);
  });

  it('descurtir o que não estava curtido não deixa o contador negativo', async () => {
    const banco = bancoFalso();
    const r = await banco.svc.curtir(EU, DECK, false);
    expect(r.likeCount).toBe(0);
    expect(banco.prisma.deck.update).not.toHaveBeenCalled();
  });

  it('curtir e descurtir voltam o contador ao zero', async () => {
    const banco = bancoFalso();
    await banco.svc.curtir(EU, DECK, true);
    const r = await banco.svc.curtir(EU, DECK, false);
    expect(r).toEqual({ curtido: false, likeCount: 0 });
  });

  it('não dá para curtir o próprio deck', async () => {
    const banco = bancoFalso();
    await expect(banco.svc.curtir(DONO, DECK, true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deck privado é 404, igual a deck que não existe', async () => {
    const banco = bancoFalso({ publico: false });
    await expect(banco.svc.curtir(EU, DECK, true)).rejects.toBeInstanceOf(NotFoundException);
    await expect(banco.svc.ver(EU, DECK)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ExplorarService.ver', () => {
  it('mostra o nome do dono e esconde o id dele', async () => {
    const banco = bancoFalso();
    const deck = (await banco.svc.ver(EU, DECK)) as Record<string, unknown>;
    expect(deck.dono).toBe('gaspare');
    expect(deck).not.toHaveProperty('userId');
  });

  /**
   * A pasta e o favorito são a organização privada do dono. Saíam na resposta
   * porque `ver` devolvia o deck inteiro menos o `userId`.
   */
  it('não mostra a pasta nem o favorito do dono', async () => {
    const banco = bancoFalso();
    const deck = (await banco.svc.ver(EU, DECK)) as Record<string, unknown>;
    expect(deck).not.toHaveProperty('folder');
    expect(deck).not.toHaveProperty('isFavorite');
  });
});

describe('ExplorarService.copiar', () => {
  it('a cópia nasce na conta de quem copiou, privada, com as mesmas linhas', async () => {
    const banco = bancoFalso();
    const novo = (await banco.svc.copiar(EU, DECK)) as Record<string, unknown>;

    expect(novo.userId).toBe(EU);
    expect(novo).not.toHaveProperty('isPublic', true);
    expect(String(novo.name)).toContain('de gaspare');
    expect(banco.linhasCriadas).toHaveLength(2);
    expect(banco.linhasCriadas.every((l) => l.deckId === 'deck-novo')).toBe(true);
  });

  it(`no teto de ${MAXIMO_DE_DECKS_POR_CONTA} decks, a cópia não nasce`, async () => {
    const banco = bancoFalso();
    banco.prisma.deck.count.mockResolvedValue(MAXIMO_DE_DECKS_POR_CONTA);

    await expect(banco.svc.copiar(EU, DECK)).rejects.toBeInstanceOf(BadRequestException);
    expect(banco.criados).toHaveLength(0);
  });
});
