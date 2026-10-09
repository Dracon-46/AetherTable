/**
 * auditoria.service.spec.ts — o IP da auditoria não é escrito pelo cliente.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * O IP gravado era o PRIMEIRO endereço do `X-Forwarded-For`, e o proxy do
 * Render acrescenta ao cabeçalho que recebeu em vez de substituí-lo. Quem
 * mandasse `X-Forwarded-For: 1.2.3.4` escolhia o IP que a trilha de auditoria
 * registraria para as ações administrativas dele.
 *
 * `req.ip` é o que o Express resolve com `trust proxy: 1` — o endereço que o
 * nosso proxy viu, e não o que o cliente declarou.
 */

import { AdminAction, Role } from '@prisma/client';
import { AuditoriaService } from './auditoria.service.js';
import type { RequisicaoAdmin } from './papeis.js';

function montar() {
  const prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
  return { svc: new AuditoriaService(prisma as never), prisma };
}

const req = (extra: Partial<RequisicaoAdmin>): RequisicaoAdmin => ({
  user: { sub: 'a', username: 'admin' },
  autor: { id: 'a', username: 'admin', role: Role.ADMIN },
  headers: {},
  ...extra,
});

const ipGravado = (prisma: ReturnType<typeof montar>['prisma']) =>
  (prisma.auditLog.create.mock.calls[0]![0] as { data: { ip: string | null } }).data.ip;

describe('AuditoriaService — IP de origem', () => {
  it('ignora o X-Forwarded-For forjado e grava o `req.ip` resolvido pelo Express', async () => {
    const { svc, prisma } = montar();

    await svc.registrar(
      req({ ip: '203.0.113.7', headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' } }),
      { action: AdminAction.USER_SUSPEND, targetType: 'user', targetId: 'x' },
    );

    expect(ipGravado(prisma)).toBe('203.0.113.7');
  });

  it('sem `req.ip`, grava nulo — e não o cabeçalho', async () => {
    const { svc, prisma } = montar();

    await svc.registrar(req({ headers: { 'x-forwarded-for': '1.2.3.4' } }), {
      action: AdminAction.USER_SUSPEND,
      targetType: 'user',
    });

    expect(ipGravado(prisma)).toBeNull();
  });
});
