/**
 * notificacoes.service.spec.ts — os avisos do sino.
 *
 * O que estes casos fixam: curtidas vêm agregadas por deck e sem nome de quem
 * curtiu; a própria curtida não conta; a denúncia analisada diz só o
 * desfecho; tudo em ordem do mais recente.
 */

import { BadRequestException } from '@nestjs/common';
import { NotificacoesService } from './notificacoes.service.js';
import { MarcarLeituraDto } from './notificacoes.dto.js';

const AGORA = new Date('2026-10-14T12:00:00Z');
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000);

function montar(curtidas: unknown[], denuncias: unknown[], comentarios: unknown[] = []) {
  const prisma = {
    deckLike: { findMany: jest.fn().mockResolvedValue(curtidas) },
    deckComment: { findMany: jest.fn().mockResolvedValue(comentarios) },
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

it('comentários de outras pessoas nos meus decks, agregados por deck', async () => {
  const deck = { id: 'd1', name: 'Atraxa' };
  const { servico, prisma } = montar(
    [],
    [],
    [
      { createdAt: horasAtras(1), deck },
      { createdAt: horasAtras(3), deck },
    ],
  );
  const itens = await servico.listar('u1', AGORA);
  expect(itens).toEqual([
    { tipo: 'COMENTARIOS', em: horasAtras(1), deckId: 'd1', nomeDoDeck: 'Atraxa', quantos: 2 },
  ]);
  expect(prisma.deckComment.findMany.mock.calls[0][0].where.userId).toEqual({ not: 'u1' });
});

/**
 * ─── O "JÁ VI" NA CONTA ─────────────────────────────────────────────────────
 *
 * O sino guardava a leitura só no navegador; em outra máquina tudo acendia
 * de novo. O que estes casos fixam: a data só AVANÇA (e quem garante é um
 * UPDATE condicional, não uma comparação no Node); data muito no futuro é
 * recusada; a versão de Novidades é gravada como veio; conta sem linha de
 * preferências lê "nunca abriu".
 */
describe('leitura do sino', () => {
  interface Prefs {
    userId: string;
    notificacoesVistasEm: Date | null;
    novidadeVista: string | null;
  }
  interface Onde {
    userId: string;
    OR?: ({ notificacoesVistasEm: null } | { notificacoesVistasEm: { lt: Date } })[];
  }

  /** Dublê em memória de `user_preferences`, só com o que o serviço usa. */
  function montarLeitura(inicial: Prefs | null) {
    let linha: Prefs | null = inicial ? { ...inicial } : null;
    const casa = (w: Onde) =>
      linha !== null &&
      linha.userId === w.userId &&
      (!w.OR ||
        w.OR.some((c) =>
          c.notificacoesVistasEm === null
            ? linha!.notificacoesVistasEm === null
            : linha!.notificacoesVistasEm !== null &&
              linha!.notificacoesVistasEm.getTime() < c.notificacoesVistasEm.lt.getTime(),
        ));
    const userPreference = {
      findUnique: jest.fn(async () => (linha ? { ...linha } : null)),
      upsert: jest.fn(async ({ create, update }: { create: Prefs; update: Partial<Prefs> }) => {
        if (linha) Object.assign(linha, update);
        else linha = { ...create };
        return { ...linha };
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Onde; data: Partial<Prefs> }) => {
        if (!casa(where)) return { count: 0 };
        Object.assign(linha!, data);
        return { count: 1 };
      }),
    };
    const prisma = {
      userPreference,
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    return {
      servico: new NotificacoesService(prisma as never),
      prisma,
      linha: () => linha,
    };
  }

  it('conta sem linha de preferências lê "nunca abriu"', async () => {
    const { servico } = montarLeitura(null);
    expect(await servico.leitura('u1')).toEqual({ vistoEm: null, novidadeVista: null });
  });

  it('devolve o que a conta guardou, em ISO', async () => {
    const { servico } = montarLeitura({
      userId: 'u1',
      notificacoesVistasEm: horasAtras(2),
      novidadeVista: '0.9.6',
    });
    expect(await servico.leitura('u1')).toEqual({
      vistoEm: horasAtras(2).toISOString(),
      novidadeVista: '0.9.6',
    });
  });

  it('a primeira marcação cria a linha', async () => {
    const { servico, linha } = montarLeitura(null);
    const r = await servico.marcarLeitura(
      'u1',
      { vistoEm: horasAtras(1).toISOString(), novidadeVista: '0.9.6' },
      AGORA,
    );
    expect(r).toEqual({ vistoEm: horasAtras(1).toISOString(), novidadeVista: '0.9.6' });
    expect(linha()).toMatchObject({ notificacoesVistasEm: horasAtras(1), novidadeVista: '0.9.6' });
  });

  it('o vistoEm só avança: uma máquina atrasada não reacende o que já foi visto', async () => {
    const { servico, linha } = montarLeitura({
      userId: 'u1',
      notificacoesVistasEm: horasAtras(1),
      novidadeVista: '0.9.5',
    });
    const r = await servico.marcarLeitura(
      'u1',
      { vistoEm: horasAtras(5).toISOString(), novidadeVista: '0.9.6' },
      AGORA,
    );
    expect(r.vistoEm).toBe(horasAtras(1).toISOString());
    expect(linha()!.notificacoesVistasEm).toEqual(horasAtras(1));
    // A versão é gravada como veio.
    expect(linha()!.novidadeVista).toBe('0.9.6');
  });

  it('uma data mais nova avança', async () => {
    const { servico, linha } = montarLeitura({
      userId: 'u1',
      notificacoesVistasEm: horasAtras(5),
      novidadeVista: '0.9.6',
    });
    await servico.marcarLeitura(
      'u1',
      { vistoEm: horasAtras(1).toISOString(), novidadeVista: '0.9.6' },
      AGORA,
    );
    expect(linha()!.notificacoesVistasEm).toEqual(horasAtras(1));
  });

  it('o avanço é um UPDATE condicional no banco, na mesma transação do upsert', async () => {
    const { servico, prisma } = montarLeitura(null);
    const vistoEm = horasAtras(1);
    await servico.marcarLeitura(
      'u1',
      { vistoEm: vistoEm.toISOString(), novidadeVista: 'x' },
      AGORA,
    );
    expect(prisma.userPreference.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        OR: [{ notificacoesVistasEm: null }, { notificacoesVistasEm: { lt: vistoEm } }],
      },
      data: { notificacoesVistasEm: vistoEm },
    });
    expect(prisma.userPreference.upsert.mock.calls[0]![0].update).toEqual({ novidadeVista: 'x' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('relógio adiantado até 5 minutos passa; mais que isso é 400 e nada é gravado', async () => {
    const { servico, prisma } = montarLeitura(null);
    const quatroMinutos = new Date(AGORA.getTime() + 4 * 60_000).toISOString();
    await expect(
      servico.marcarLeitura('u1', { vistoEm: quatroMinutos, novidadeVista: 'x' }, AGORA),
    ).resolves.toMatchObject({ vistoEm: quatroMinutos });

    const amanha = new Date(AGORA.getTime() + 24 * 3_600_000).toISOString();
    prisma.$transaction.mockClear();
    await expect(
      servico.marcarLeitura('u1', { vistoEm: amanha, novidadeVista: 'x' }, AGORA),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('MarcarLeituraDto', () => {
  it('exige data ISO e uma versão de até 32 caracteres', () => {
    expect(
      MarcarLeituraDto.safeParse({ vistoEm: '2026-10-14T11:00:00.000Z', novidadeVista: '0.9.6' })
        .success,
    ).toBe(true);
    expect(
      MarcarLeituraDto.safeParse({
        vistoEm: '2026-10-14T11:00:00-03:00',
        novidadeVista: '0.9.6',
      }).success,
    ).toBe(true);
    for (const ruim of [
      { vistoEm: 'ontem', novidadeVista: '0.9.6' },
      { vistoEm: '2026-10-14', novidadeVista: '0.9.6' },
      { vistoEm: '2026-10-14T11:00:00.000Z', novidadeVista: '' },
      { vistoEm: '2026-10-14T11:00:00.000Z', novidadeVista: 'x'.repeat(33) },
      { vistoEm: '2026-10-14T11:00:00.000Z' },
      { novidadeVista: '0.9.6' },
    ]) {
      expect(MarcarLeituraDto.safeParse(ruim).success).toBe(false);
    }
  });
});
