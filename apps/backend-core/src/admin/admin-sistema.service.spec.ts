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

/**
 * Placa de nome — a família nova precisa nascer registrável.
 *
 * O `PET` entrou no catálogo sem valor no enum do banco e, até a migração
 * `tipo_pet`, não podia ser registrado, concedido nem criado pelo painel. A
 * placa entra com `CosmeticType.NAMEPLATE` desde o primeiro dia, e estes casos
 * fixam os dois caminhos de `criarCosmetico` para ela.
 */
describe('AdminSistemaService.criarCosmetico — placa de nome', () => {
  function montarCriacao() {
    const prisma = {
      cosmeticItem: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(async ({ data }: { data: object }) => ({ id: ITEM, ...data })),
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
    const criado = () =>
      (prisma.cosmeticItem.create.mock.calls[0]![0] as { data: Record<string, unknown> }).data;
    return { svc, req, criado };
  }

  it('registra uma placa do catálogo em código, sem `parametros`', async () => {
    const { svc, req, criado } = montarCriacao();

    await svc.criarCosmetico(req, {
      catalogoId: 'ouro-real',
      tipo: CosmeticType.NAMEPLATE,
      nome: 'Ouro Real',
      minTier: 1,
      ativo: true,
    });

    expect(criado()).toMatchObject({ type: CosmeticType.NAMEPLATE, resourceUrl: 'ouro-real' });
    expect(criado()).not.toHaveProperty('parametros');
  });

  it('compõe uma placa autoral e grava o item NORMALIZADO', async () => {
    const { svc, req, criado } = montarCriacao();

    await svc.criarCosmetico(req, {
      catalogoId: 'placa-campeao-2026',
      tipo: CosmeticType.NAMEPLATE,
      nome: 'Campeão 2026',
      minTier: 1,
      ativo: true,
      // O que o formulário manda: campos de todas as famílias misturados.
      parametros: {
        cor1: '#112233',
        cor2: '#445566',
        borda: '#FACC15',
        texto: '#ffffff',
        estilo: 'brilho',
        forma: 'slime',
      },
    });

    expect(criado().parametros).toEqual({
      id: 'placa-campeao-2026',
      nome: 'Campeão 2026',
      tier: 'APOIADOR',
      cores: ['#112233', '#445566'],
      borda: '#facc15',
      texto: '#ffffff',
      estilo: 'brilho',
    });
  });

  it('recusa placa autoral que redefine a do bundle', async () => {
    const { svc, req } = montarCriacao();

    await expect(
      svc.criarCosmetico(req, {
        catalogoId: 'padrao',
        tipo: CosmeticType.NAMEPLATE,
        nome: 'Sequestro',
        minTier: 0,
        ativo: true,
        parametros: {
          cor1: '#112233',
          cor2: '#445566',
          borda: '#facc15',
          texto: '#ffffff',
          estilo: 'placa',
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
