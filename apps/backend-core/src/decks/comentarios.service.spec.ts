/**
 * comentarios.service.spec.ts — a conversa embaixo de um deck público.
 *
 * O que estes casos fixam: deck privado é 404 (igual a inexistente); quem o
 * dono bloqueou não comenta, e a mensagem não conta que houve bloqueio; apagar
 * é do autor ou do dono do deck; a lista sai do mais antigo ao mais novo.
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ComentariosService } from './comentarios.service.js';

function montar(opcoes: { deck?: { id: string; userId: string } | null; bloqueio?: boolean } = {}) {
  const deck = opcoes.deck === undefined ? { id: 'd1', userId: 'dono' } : opcoes.deck;
  const prisma = {
    deck: { findFirst: jest.fn().mockResolvedValue(deck) },
    block: {
      findUnique: jest.fn().mockResolvedValue(opcoes.bloqueio ? { blockerId: 'dono' } : null),
    },
    deckComment: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'c2',
          text: 'segundo',
          createdAt: new Date('2026-10-14T12:00:00Z'),
          userId: 'u2',
          user: { username: 'u2', displayName: null },
        },
        {
          id: 'c1',
          text: 'primeiro',
          createdAt: new Date('2026-10-14T11:00:00Z'),
          userId: 'u1',
          user: { username: 'u1', displayName: 'Um' },
        },
      ]),
      create: jest.fn().mockResolvedValue({ id: 'novo', createdAt: new Date() }),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  };
  return { servico: new ComentariosService(prisma as never), prisma };
}

it('lista do mais antigo ao mais novo, com quem pode apagar', async () => {
  const { servico } = montar();
  const lista = await servico.listar('u1', 'd1');
  expect(lista.map((c) => c.texto)).toEqual(['primeiro', 'segundo']);
  expect(lista[0]).toMatchObject({ meu: true, podeApagar: true, autor: { nome: 'Um' } });
  expect(lista[1]).toMatchObject({ meu: false, podeApagar: false, autor: { nome: 'u2' } });
});

it('o dono do deck pode apagar qualquer comentário da lista', async () => {
  const { servico } = montar();
  const lista = await servico.listar('dono', 'd1');
  expect(lista.every((c) => c.podeApagar)).toBe(true);
});

it('deck privado ou inexistente é 404, sem distinguir', async () => {
  const { servico } = montar({ deck: null });
  await expect(servico.listar('u1', 'd1')).rejects.toBeInstanceOf(NotFoundException);
  await expect(servico.comentar('u1', 'd1', 'oi')).rejects.toBeInstanceOf(NotFoundException);
});

it('quem o dono bloqueou não comenta — e a mensagem não fala em bloqueio', async () => {
  const { servico, prisma } = montar({ bloqueio: true });
  const erro = await servico.comentar('u9', 'd1', 'oi').catch((e: unknown) => e);
  expect(erro).toBeInstanceOf(ForbiddenException);
  expect((erro as Error).message).not.toMatch(/bloque/i);
  expect(prisma.deckComment.create).not.toHaveBeenCalled();
});

it('o dono comenta no próprio deck sem consultar bloqueio', async () => {
  const { servico, prisma } = montar();
  await servico.comentar('dono', 'd1', 'obrigado!');
  expect(prisma.block.findUnique).not.toHaveBeenCalled();
  expect(prisma.deckComment.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: { deckId: 'd1', userId: 'dono', text: 'obrigado!' } }),
  );
});

it('apagar: autor ou dono do deck; os outros recebem 403', async () => {
  const { servico, prisma } = montar();
  prisma.deckComment.findFirst.mockResolvedValue({ userId: 'u1', deck: { userId: 'dono' } });

  await expect(servico.apagar('u2', 'd1', 'c1')).rejects.toBeInstanceOf(ForbiddenException);
  await servico.apagar('u1', 'd1', 'c1');
  await servico.apagar('dono', 'd1', 'c1');
  expect(prisma.deckComment.delete).toHaveBeenCalledTimes(2);
});
