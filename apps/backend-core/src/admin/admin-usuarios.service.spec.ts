/**
 * admin-usuarios.service.spec.ts — punição que vale AGORA, e não no próximo login.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * `suspender` e `banir` gravavam `suspendedUntil`/`deletedAt` e paravam aí. A
 * suspensão era conferida só no login, então quem já tinha um token seguia
 * dentro — jogando, criando mesas, editando decks — até ele expirar. A
 * redefinição de senha já gravava o corte de sessão; as punições, não.
 *
 * O Prisma é um duplo: estes testes fixam o que é ESCRITO, sem tocar banco.
 */

import { Role } from '@prisma/client';
import { AdminUsuariosService } from './admin-usuarios.service.js';
import type { RequisicaoAdmin } from './papeis.js';

const MODERADOR = '11111111-1111-4111-8111-111111111111';
const ALVO = '22222222-2222-4222-8222-222222222222';

function montar() {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: ALVO,
        username: 'alvo',
        email: 'alvo@exemplo.com',
        role: Role.USER,
        deletedAt: null,
        supporterTier: 'FREE',
      }),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(1),
    },
  };
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const svc = new AdminUsuariosService(prisma as never, auditoria as never);
  const req: RequisicaoAdmin = {
    user: { sub: MODERADOR, username: 'mod' },
    autor: { id: MODERADOR, username: 'mod', role: Role.ADMIN },
    headers: {},
  };
  return { svc, prisma, req };
}

describe('AdminUsuariosService — punições derrubam as sessões abertas', () => {
  it('suspender grava o corte de sessão junto da suspensão', async () => {
    const { svc, prisma, req } = montar();
    const antes = Date.now();

    await svc.suspender(req, ALVO, { dias: 7, motivo: 'ofensas repetidas no chat' });

    const { data } = prisma.user.update.mock.calls[0]![0] as {
      data: { suspendedUntil: Date; tokensValidosApos?: Date };
    };
    expect(data.suspendedUntil).toBeInstanceOf(Date);
    expect(data.tokensValidosApos).toBeInstanceOf(Date);
    expect(data.tokensValidosApos!.getTime()).toBeGreaterThanOrEqual(antes);
  });

  it('banir grava o corte de sessão junto do banimento', async () => {
    const { svc, prisma, req } = montar();

    await svc.banir(req, ALVO, { motivo: 'trapaça confirmada em partida' });

    const { data } = prisma.user.update.mock.calls[0]![0] as {
      data: { deletedAt: Date; tokensValidosApos?: Date };
    };
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(data.tokensValidosApos).toBeInstanceOf(Date);
  });
});
