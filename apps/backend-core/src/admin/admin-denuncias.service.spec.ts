/**
 * admin-denuncias.service.spec.ts — o moderador não julga a denúncia contra si.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * `resolver` não comparava o denunciado com quem estava resolvendo. Um
 * moderador denunciado podia encerrar o próprio caso como improcedente, e a
 * denúncia — às vezes a única evidência de um padrão de conduta — saía da fila.
 *
 * Prisma em duplo; nada toca o banco.
 */

import { ForbiddenException } from '@nestjs/common';
import { ReportReason, ReportStatus, Role } from '@prisma/client';
import { AdminDenunciasService } from './admin-denuncias.service.js';
import type { RequisicaoAdmin } from './papeis.js';

const MODERADOR = '11111111-1111-4111-8111-111111111111';
const OUTRO = '22222222-2222-4222-8222-222222222222';
const DENUNCIA = '44444444-4444-4444-8444-444444444444';

function montar(denunciadoId: string) {
  const prisma = {
    report: {
      findUnique: jest.fn().mockResolvedValue({
        id: DENUNCIA,
        status: ReportStatus.OPEN,
        reason: ReportReason.HARASSMENT,
        reported: { id: denunciadoId, username: 'denunciado' },
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const svc = new AdminDenunciasService(prisma as never, auditoria as never);
  const req: RequisicaoAdmin = {
    user: { sub: MODERADOR, username: 'mod' },
    autor: { id: MODERADOR, username: 'mod', role: Role.MOD },
    headers: {},
  };
  return { svc, prisma, req };
}

const ENCERRAR = { status: ReportStatus.DISMISSED, resolucao: 'denúncia sem fundamento' } as const;

describe('AdminDenunciasService — denúncia contra o próprio moderador', () => {
  it('resolver a denúncia contra si é recusado, e nada é gravado', async () => {
    const { svc, prisma, req } = montar(MODERADOR);

    await expect(svc.resolver(req, DENUNCIA, ENCERRAR)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.report.update).not.toHaveBeenCalled();
  });

  it('assumir a denúncia contra si também é recusado', async () => {
    const { svc, prisma, req } = montar(MODERADOR);

    await expect(svc.assumir(req, DENUNCIA)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.report.update).not.toHaveBeenCalled();
  });

  it('a denúncia contra OUTRA pessoa segue normalmente', async () => {
    const { svc, prisma, req } = montar(OUTRO);

    await expect(svc.resolver(req, DENUNCIA, ENCERRAR)).resolves.toEqual({
      status: ReportStatus.DISMISSED,
    });
    expect(prisma.report.update).toHaveBeenCalledTimes(1);
  });
});
