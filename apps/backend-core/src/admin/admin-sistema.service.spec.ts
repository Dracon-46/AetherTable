/**
 * admin-sistema.service.spec.ts — editar um cosmético autoral muda o item de verdade.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * Um item autoral é desenhado e julgado a partir de `parametros`, que tem
 * `tier` e `nome` próprios. A edição mudava só as colunas `minTier` e `name`:
 * o painel dizia "gratuito" e a mesa continuava exigindo apoiador, e o nome
 * novo nunca chegava aos jogadores.
 *
 * O Prisma é um duplo; o item de fixture é o que `normalizarCosmeticoAutoral`
 * de fato produz na criação, não um objeto inventado.
 */

import { CosmeticType, Role } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { AdminSistemaService } from './admin-sistema.service.js';
import type { RequisicaoAdmin } from './papeis.js';

const ITEM = '33333333-3333-4333-8333-333333333333';

/** O `parametros` que `criarCosmetico` grava para um sleeve de apoiador. */
const SLEEVE_AUTORAL = {
  id: 'sleeve-campeao-2026',
  nome: 'Campeão 2026',
  tier: 'APOIADOR',
  cores: ['#112233', '#445566'],
  borda: '#778899',
  detalhe: '#aabbcc',
  padrao: 'losango',
};

function montar(parametros: object | null = SLEEVE_AUTORAL) {
  const linha = {
    id: ITEM,
    type: CosmeticType.SLEEVE,
    name: 'Campeão 2026',
    resourceUrl: 'sleeve-campeao-2026',
    minTier: 1,
    isActive: true,
    parametros,
  };
  const prisma = {
    cosmeticItem: {
      findUnique: jest.fn().mockResolvedValue(linha),
      update: jest.fn(async ({ data }: { data: object }) => ({ ...linha, ...data })),
    },
  };
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const catalogo = { invalidar: jest.fn() };
  const svc = new AdminSistemaService(
    prisma as never,
    auditoria as never,
    {} as never,
    catalogo as never,
  );
  const req: RequisicaoAdmin = {
    user: { sub: 'a', username: 'admin' },
    autor: { id: 'a', username: 'admin', role: Role.ADMIN },
    headers: {},
  };
  return { svc, prisma, req };
}

const gravado = (prisma: ReturnType<typeof montar>['prisma']) =>
  (prisma.cosmeticItem.update.mock.calls[0]![0] as { data: Record<string, unknown> }).data;

describe('AdminSistemaService.atualizarCosmetico — item autoral', () => {
  it('baixar o minTier para 0 torna o item FREE também em `parametros`', async () => {
    const { svc, prisma, req } = montar();

    await svc.atualizarCosmetico(req, ITEM, { minTier: 0 });

    expect(gravado(prisma)).toMatchObject({ minTier: 0, parametros: { tier: 'FREE' } });
  });

  it('subir o minTier torna o item APOIADOR em `parametros`', async () => {
    const { svc, prisma, req } = montar({ ...SLEEVE_AUTORAL, tier: 'FREE' });

    await svc.atualizarCosmetico(req, ITEM, { minTier: 2 });

    expect(gravado(prisma)).toMatchObject({ parametros: { tier: 'APOIADOR' } });
  });

  it('renomear muda o nome que os jogadores veem', async () => {
    const { svc, prisma, req } = montar();

    await svc.atualizarCosmetico(req, ITEM, { nome: 'Campeã 2026' });

    expect(gravado(prisma)).toMatchObject({
      name: 'Campeã 2026',
      parametros: { nome: 'Campeã 2026', tier: 'APOIADOR', padrao: 'losango' },
    });
  });

  it('um nome que o item autoral não comporta é recusado, em vez de sumir com o item', async () => {
    const { svc, prisma, req } = montar();

    await expect(
      svc.atualizarCosmetico(req, ITEM, { nome: 'x'.repeat(60) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.cosmeticItem.update).not.toHaveBeenCalled();
  });

  it('item do catálogo em código (sem `parametros`) continua mudando só as colunas', async () => {
    const { svc, prisma, req } = montar(null);

    await svc.atualizarCosmetico(req, ITEM, { minTier: 0 });

    expect(gravado(prisma)).toEqual({ minTier: 0 });
  });
});
