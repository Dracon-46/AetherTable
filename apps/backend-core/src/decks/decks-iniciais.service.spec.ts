/**
 * decks-iniciais.service.spec.ts — a vitrine de decks prontos e o "usar".
 *
 * O que estes casos fixam:
 *
 *   - os dados gerados do MTGJSON estão íntegros: todo deck tem comandante e
 *     exatamente cem cartas, sem impressão repetida no mesmo board (a chave
 *     única do banco recusaria a cópia inteira);
 *   - "usar" copia a lista para a conta, com comandante e cores, e escolher o
 *     mesmo deck de novo REENCONTRA a cópia em vez de criar outra.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DecksIniciaisService } from './decks-iniciais.service.js';
import { MAXIMO_DE_DECKS_POR_CONTA } from './limites-de-conta.js';
import { DECKS_INICIAIS } from './decks-iniciais.dados.js';

function bancoFalso() {
  const decks: Record<string, unknown>[] = [];
  const linhas: Record<string, unknown>[] = [];
  const ref: { tx?: unknown } = {};
  const prisma = {
    deck: {
      findFirst: jest.fn(
        async ({ where }: { where: { userId: string; name: string; description: string } }) =>
          decks.find(
            (d) =>
              d.userId === where.userId &&
              d.name === where.name &&
              d.description === where.description,
          ) ?? null,
      ),
      count: jest.fn(
        async ({ where }: { where: { userId: string } }) =>
          decks.filter((d) => d.userId === where.userId).length,
      ),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const novo = { id: `deck-${decks.length + 1}`, ...data };
        decks.push(novo);
        return novo;
      }),
    },
    deckCard: {
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        linhas.push(...data);
        return { count: data.length };
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
      fn(ref.tx),
    ),
  };
  ref.tx = prisma;
  return { svc: new DecksIniciaisService(prisma as never), prisma, decks, linhas };
}

describe('os dados dos decks iniciais', () => {
  it.each(DECKS_INICIAIS.map((d) => [d.nome, d]))(
    '%s: comandante, cem cartas e nenhuma impressão repetida por board',
    (_nome, deck) => {
      expect(deck.comandantes.length).toBeGreaterThan(0);
      expect(deck.cartas.reduce((s, c) => s + c.quantity, 0)).toBe(100);
      const chaves = deck.cartas.map((c) => `${c.scryfallId}:${c.boardType}`);
      expect(new Set(chaves).size).toBe(chaves.length);
      for (const id of deck.comandantes) {
        expect(deck.cartas).toContainEqual(
          expect.objectContaining({ scryfallId: id, boardType: 'COMMANDER' }),
        );
      }
    },
  );
});

describe('DecksIniciaisService', () => {
  it('a vitrine lista os decks sem as cem cartas de cada um', () => {
    const { svc } = bancoFalso();
    const vitrine = svc.listar();
    expect(vitrine).toHaveLength(DECKS_INICIAIS.length);
    expect(vitrine[0]).not.toHaveProperty('cartas');
    expect(vitrine[0]!.totalDeCartas).toBe(100);
  });

  it('usar copia a lista para a conta, com comandante e cores', async () => {
    const { svc, linhas } = bancoFalso();
    const inicial = DECKS_INICIAIS[0]!;

    const deck = (await svc.usar('conta-1', inicial.codigo)) as Record<string, unknown>;

    expect(deck).toMatchObject({
      userId: 'conta-1',
      name: inicial.nome,
      formatId: 'commander',
      commanderId: inicial.comandantes[0],
      colorIdentity: inicial.cores,
      cardCount: 100,
    });
    expect(linhas).toHaveLength(inicial.cartas.length);
  });

  it('escolher o mesmo deck de novo reencontra a cópia, sem duplicar', async () => {
    const { svc, decks } = bancoFalso();
    const codigo = DECKS_INICIAIS[1]!.codigo;

    const primeiro = (await svc.usar('conta-1', codigo)) as { id: string };
    const segundo = (await svc.usar('conta-1', codigo)) as { id: string };

    expect(segundo.id).toBe(primeiro.id);
    expect(decks).toHaveLength(1);
  });

  it(`no teto de ${MAXIMO_DE_DECKS_POR_CONTA} decks, a cópia nova não nasce`, async () => {
    const { svc, prisma, decks } = bancoFalso();
    prisma.deck.count.mockResolvedValue(MAXIMO_DE_DECKS_POR_CONTA);

    await expect(svc.usar('conta-1', DECKS_INICIAIS[0]!.codigo)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(decks).toHaveLength(0);
  });

  it('reencontrar a cópia que já existe não depende de vaga', async () => {
    const { svc, prisma } = bancoFalso();
    const codigo = DECKS_INICIAIS[0]!.codigo;
    const primeiro = (await svc.usar('conta-1', codigo)) as { id: string };

    prisma.deck.count.mockResolvedValue(MAXIMO_DE_DECKS_POR_CONTA);
    const segundo = (await svc.usar('conta-1', codigo)) as { id: string };

    expect(segundo.id).toBe(primeiro.id);
  });

  it('código que não existe é 404', async () => {
    const { svc } = bancoFalso();
    await expect(svc.usar('conta-1', 'NaoExiste_XYZ')).rejects.toBeInstanceOf(NotFoundException);
  });
});
