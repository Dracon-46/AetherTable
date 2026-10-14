/**
 * notificacoes.service.spec.ts — os avisos do sino.
 *
 * O que estes casos fixam: curtidas vêm agregadas por deck e sem nome de quem
 * curtiu; a própria curtida não conta; a denúncia analisada diz só o
 * desfecho; tudo em ordem do mais recente.
 */

import { NotificacoesService } from './notificacoes.service.js';

const AGORA = new Date('2026-10-14T12:00:00Z');
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000);

function montar(curtidas: unknown[], denuncias: unknown[]) {
  const prisma = {
    deckLike: { findMany: jest.fn().mockResolvedValue(curtidas) },
    report: { findMany: jest.fn().mockResolvedValue(denuncias) },
  };
  return { servico: new NotificacoesService(prisma as never), prisma };
}

it('agrega as curtidas por deck, datadas pela mais recente, sem nomes', async () => {
  const deck = { id: 'd1', name: 'Atraxa' };
  const { servico } = montar(
    [
      { createdAt: horasAtras(1), deck },
      { createdAt: horasAtras(5), deck },
      { createdAt: horasAtras(9), deck: { id: 'd2', name: 'Krenko' } },
    ],
    [],
  );
  const itens = await servico.listar('u1', AGORA);

  expect(itens).toEqual([
    { tipo: 'CURTIDAS', em: horasAtras(1), deckId: 'd1', nomeDoDeck: 'Atraxa', quantas: 2 },
    { tipo: 'CURTIDAS', em: horasAtras(9), deckId: 'd2', nomeDoDeck: 'Krenko', quantas: 1 },
  ]);
  expect(JSON.stringify(itens)).not.toMatch(/username|displayName/);
});

it('a consulta ignora a própria curtida e olha só os últimos 30 dias', async () => {
  const { servico, prisma } = montar([], []);
  await servico.listar('u1', AGORA);
  const where = prisma.deckLike.findMany.mock.calls[0][0].where;
  expect(where.userId).toEqual({ not: 'u1' });
  expect(where.deck).toEqual({ userId: 'u1' });
  expect(where.createdAt.gte).toEqual(horasAtras(30 * 24));
});

it('denúncia analisada entra na ordem certa, só com o desfecho', async () => {
  const { servico } = montar(
    [{ createdAt: horasAtras(10), deck: { id: 'd1', name: 'Atraxa' } }],
    [{ id: 'r1', status: 'DISMISSED', resolvedAt: horasAtras(2) }],
  );
  const itens = await servico.listar('u1', AGORA);
  expect(itens[0]).toEqual({
    tipo: 'DENUNCIA_ANALISADA',
    em: horasAtras(2),
    denunciaId: 'r1',
    desfecho: 'DISMISSED',
  });
  expect(itens[1]!.tipo).toBe('CURTIDAS');
});
