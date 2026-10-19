/**
 * admin-bootstrap.service.spec.ts — `ADMIN_EMAILS` só promove dono de e-mail.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * O boot promovia a ADMIN qualquer conta cujo e-mail estivesse na lista, sem
 * olhar se o e-mail tinha sido confirmado. O cadastro por senha não confirma
 * e-mail: bastava alguém se cadastrar com o endereço do dono antes dele para
 * ganhar o painel administrativo no próximo deploy.
 *
 * O Prisma é um duplo; o `Logger` é espiado para fixar que o operador recebe o
 * motivo — uma promoção que não acontece em silêncio é um chamado de suporte.
 */

import { Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AdminBootstrapService } from './admin-bootstrap.service.js';

const EMAIL = 'dono@aethertable.app';

function montar(conta: { emailVerifiedAt: Date | null; role?: Role }) {
  const prisma = {
    user: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: '11111111-1111-4111-8111-111111111111',
          email: EMAIL,
          username: 'dono',
          role: conta.role ?? Role.USER,
          deletedAt: null,
          emailVerifiedAt: conta.emailVerifiedAt,
        },
      ]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  return { svc: new AdminBootstrapService(prisma as never), prisma };
}

describe('AdminBootstrapService — ADMIN_EMAILS exige e-mail confirmado', () => {
  const antes = process.env.ADMIN_EMAILS;
  let aviso: jest.SpyInstance;

  beforeEach(() => {
    process.env.ADMIN_EMAILS = EMAIL;
    aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (antes === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = antes;
  });

  it('NÃO promove a conta cujo e-mail nunca foi confirmado', async () => {
    const { svc, prisma } = montar({ emailVerifiedAt: null });

    await svc.onModuleInit();

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('avisa o operador do motivo, com o que fazer', async () => {
    const { svc } = montar({ emailVerifiedAt: null });

    await svc.onModuleInit();

    const mensagens = aviso.mock.calls.map((c) => String(c[0]));
    expect(mensagens.some((m) => m.includes(EMAIL) && m.includes('nunca foi confirmado'))).toBe(
      true,
    );
  });

  it('promove a conta confirmada, com a confirmação também no WHERE da escrita', async () => {
    const { svc, prisma } = montar({ emailVerifiedAt: new Date('2026-09-01') });

    await svc.onModuleInit();

    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ emailVerifiedAt: { not: null } }),
        data: { role: Role.ADMIN },
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
