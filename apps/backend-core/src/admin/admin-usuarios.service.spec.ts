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

import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
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
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(1),
    },
    $transaction: jest.fn(
      async (fn: (tx: unknown) => Promise<unknown>, _opcoes?: unknown): Promise<unknown> =>
        fn(transacao),
    ),
  };
  // A transação recebe o próprio duplo como `tx`, como o Prisma faz.
  const transacao: unknown = prisma;
  const auditoria = {
    registrar: jest.fn().mockResolvedValue(undefined),
    registrarOuFalhar: jest.fn().mockResolvedValue(undefined),
  };
  const svc = new AdminUsuariosService(prisma as never, auditoria as never);
  const req: RequisicaoAdmin = {
    user: { sub: MODERADOR, username: 'mod' },
    autor: { id: MODERADOR, username: 'mod', role: Role.ADMIN },
    headers: {},
  };
  return { svc, prisma, req, auditoria };
}

/** O alvo como ADMIN — o caso em que a trava do último administrador vale. */
const alvoAdmin = {
  id: ALVO,
  username: 'alvo',
  email: 'alvo@exemplo.com',
  role: Role.ADMIN,
  deletedAt: null,
  supporterTier: 'FREE',
};

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

describe('AdminUsuariosService.mudarTier — rebaixar tira a placa de apoiador', () => {
  it('a placa de apoiador volta ao padrão junto com os outros cosméticos', async () => {
    const { svc, prisma, req } = montar();
    prisma.user.findUnique.mockResolvedValue({
      id: ALVO,
      username: 'alvo',
      email: 'alvo@exemplo.com',
      role: Role.USER,
      deletedAt: null,
      supporterTier: 'APOIADOR',
    });
    const userPreference = {
      findUnique: jest.fn().mockResolvedValue({
        sleeveId: 'aether-classic',
        playmatId: null,
        borderId: 'chama',
        titleId: null,
        petId: null,
        nameplateId: 'ouro-real',
      }),
      update: jest.fn().mockResolvedValue({}),
    };
    Object.assign(prisma, { userPreference });

    const r = await svc.mudarTier(req, ALVO, { tier: 'FREE', motivo: 'fim do apoio mensal' });

    // Sem a família na lista, a conta rebaixada seguiria com a placa dourada
    // na mesa — um cosmético de apoiador que ela não pode mais equipar.
    expect(r.desequipados).toEqual(expect.arrayContaining(['chama', 'ouro-real']));
    expect(userPreference.update).toHaveBeenCalledWith({
      where: { userId: ALVO },
      data: { borderId: null, nameplateId: null },
    });
  });
});

/**
 * ─── A TRAVA DO ÚLTIMO ADMINISTRADOR TINHA UMA JANELA DE CORRIDA ────────────
 *
 * A contagem de "outros administradores" e a escrita eram duas consultas
 * soltas. Dois administradores despromovendo um ao outro ao mesmo tempo viam,
 * cada um, o outro ativo, e os dois seguiam: a plataforma ficava sem nenhum.
 * Contar e escrever na mesma transação SERIALIZÁVEL é o que o Postgres precisa
 * para derrubar uma das duas.
 */
describe('AdminUsuariosService — trava do último administrador numa transação serializável', () => {
  const serializavel = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };

  it('despromover um ADMIN conta e escreve dentro da mesma transação serializável', async () => {
    const { svc, prisma, req } = montar();
    prisma.user.findUnique.mockResolvedValue(alvoAdmin);
    const ordem: string[] = [];
    prisma.user.count.mockImplementation(async () => {
      ordem.push(`count:${prisma.$transaction.mock.calls.length}`);
      return 1;
    });
    prisma.user.update.mockImplementation(async () => {
      ordem.push(`update:${prisma.$transaction.mock.calls.length}`);
      return {};
    });

    await svc.mudarPapel(req, ALVO, { papel: Role.MOD, motivo: 'troca de função' });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), serializavel);
    // As duas aconteceram com a transação já aberta.
    expect(ordem).toEqual(['count:1', 'update:1']);
  });

  it('o último ADMIN não é banido, e nada é escrito', async () => {
    const { svc, prisma, req } = montar();
    prisma.user.findUnique.mockResolvedValue(alvoAdmin);
    prisma.user.count.mockResolvedValue(0);

    await expect(svc.banir(req, ALVO, { motivo: 'teste da trava' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('alvo que não é ADMIN não abre transação', async () => {
    const { svc, prisma, req } = montar();
    await svc.banir(req, ALVO, { motivo: 'conduta' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalled();
  });
});

/**
 * O expurgo registrava a auditoria com `registrar`, que engole a falha: com a
 * tabela fora do ar, a conta sumia sem o registro que a ordem "auditar antes
 * de apagar" existe para garantir.
 */
describe('AdminUsuariosService.excluirDefinitivamente — sem auditoria, sem expurgo', () => {
  it('se a auditoria falha, a conta NÃO é apagada', async () => {
    const { svc, prisma, req, auditoria } = montar();
    auditoria.registrarOuFalhar.mockRejectedValue(new ServiceUnavailableException());

    await expect(
      svc.excluirDefinitivamente(req, ALVO, { confirmacao: 'alvo', motivo: 'pedido LGPD' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('com a auditoria gravada, apaga', async () => {
    const { svc, prisma, req, auditoria } = montar();

    await svc.excluirDefinitivamente(req, ALVO, { confirmacao: 'alvo', motivo: 'pedido LGPD' });

    expect(auditoria.registrarOuFalhar).toHaveBeenCalled();
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: ALVO } });
  });
});
