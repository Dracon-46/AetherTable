/**
 * auth.service.spec.ts — respostas de erro que a tela consegue usar.
 *
 * Dois defeitos confirmados, os dois de CONTRATO com o frontend:
 *
 *  - senha atual errada nos Ajustes respondia 401. O `fetcher` trata todo 401
 *    como sessão expirada e faz logout: errar um campo derrubava a pessoa para
 *    o login com "Sua sessão expirou";
 *  - e-mail ou nome já usados no cadastro respondiam 409 sem `message`, e a
 *    tela — que mostra `message` — dizia só "Falha ao registrar".
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, ReportStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service.js';

/**
 * O argon2 é o de verdade — `verify` só ganha um espião em volta, para o
 * teste de tempo do login saber se a conferência aconteceu.
 */
jest.mock('argon2', () => {
  const real = jest.requireActual<typeof import('argon2')>('argon2');
  return { ...real, verify: jest.fn(real.verify) };
});

const USUARIO = '0b6c1f9e-3a5d-4c2b-9e8f-1a2b3c4d5e6f';

async function montar(existentes: { email?: boolean; username?: boolean } = {}) {
  const passwordHash = await argon2.hash('senha-atual-correta', { type: argon2.argon2id });
  const usersService = {
    findForAuthById: jest
      .fn()
      .mockResolvedValue({ id: USUARIO, username: 'gaspare', passwordHash }),
    findForAuthByEmail: jest.fn().mockResolvedValue(null),
  };
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { email?: string } }) => {
        if (where.email && existentes.email) return { id: 'outro' };
        return null;
      }),
      // O username é procurado sem diferenciar maiúsculas — `findFirst` com
      // `mode: 'insensitive'`, que o duplo responde como o Postgres.
      findFirst: jest.fn(
        async ({ where }: { where: { username?: { equals: string; mode?: string } } }) => {
          if (where.username && existentes.username) return { id: 'outro' };
          return null;
        },
      ),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(1),
    },
    report: { count: jest.fn().mockResolvedValue(0) },
    account: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(
      async (fn: (tx: unknown) => Promise<unknown>, _opcoes?: unknown): Promise<unknown> =>
        fn(transacao),
    ),
  };
  // A transação recebe o próprio duplo como `tx`, como o Prisma faz.
  const transacao: unknown = prisma;
  const sistema = { flagLigada: jest.fn().mockResolvedValue(true) };
  const jwt = { sign: jest.fn().mockReturnValue('token') };
  const svc = new AuthService(
    usersService as never,
    jwt as never,
    prisma as never,
    sistema as never,
  );
  return { svc, prisma, usersService };
}

/** O corpo que o Nest serializa na resposta. */
const corpo = (erro: unknown) =>
  (erro as ConflictException).getResponse() as Record<string, unknown>;

describe('AuthService.trocarSenha — senha atual errada', () => {
  it('é 400, não 401 — 401 faz o frontend deslogar', async () => {
    const { svc, prisma } = await montar();

    const erro = await svc.trocarSenha(USUARIO, 'senha-errada', 'senha-nova-123').catch((e) => e);

    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).message).toBe('A senha atual não confere.');
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('com a senha certa, troca e devolve um token novo', async () => {
    const { svc } = await montar();
    await expect(
      svc.trocarSenha(USUARIO, 'senha-atual-correta', 'senha-nova-123'),
    ).resolves.toMatchObject({ accessToken: 'token' });
  });
});

describe('AuthService.register — conflito com mensagem legível', () => {
  it('e-mail já cadastrado diz isso em `message`', async () => {
    const { svc } = await montar({ email: true });

    const erro = await svc.register('a@exemplo.com', 'novo_nome', 'senha-123456').catch((e) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect(corpo(erro)).toMatchObject({
      message: 'Este e-mail já está cadastrado.',
      error: 'EMAIL_IN_USE',
    });
  });

  it('nome de usuário em uso diz isso em `message`', async () => {
    const { svc } = await montar({ username: true });

    const erro = await svc.register('b@exemplo.com', 'gaspare', 'senha-123456').catch((e) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect(corpo(erro)).toMatchObject({
      message: 'Este nome de usuário já está em uso.',
      error: 'USERNAME_TAKEN',
    });
  });
});

describe('AuthService.excluirConta — quem pediu, tem: a conta é apagada na hora', () => {
  it('com nome e senha certos, APAGA a conta (não só desativa)', async () => {
    const { svc, prisma } = await montar();

    await svc.excluirConta(USUARIO, 'gaspare', 'senha-atual-correta');

    // O mesmo `user.delete` do expurgo do backoffice: o banco leva decks,
    // preferências e cosméticos em CASCADE. Soft delete deixava tudo lá.
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: USUARIO } });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('senha errada é 400 e não apaga nada', async () => {
    const { svc, prisma } = await montar();
    const erro = await svc.excluirConta(USUARIO, 'gaspare', 'chute').catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('o nome digitado precisa ser o exato da conta', async () => {
    const { svc, prisma } = await montar();
    const erro = await svc.excluirConta(USUARIO, 'Gaspare', 'senha-atual-correta').catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('conta de Google/Discord (sem senha) se exclui só com a confirmação', async () => {
    const { svc, prisma, usersService } = await montar();
    usersService.findForAuthById.mockResolvedValue({
      id: USUARIO,
      username: 'gaspare',
      passwordHash: null,
    });
    await svc.excluirConta(USUARIO, 'gaspare');
    expect(prisma.user.delete).toHaveBeenCalled();
  });

  it('o último administrador não se exclui', async () => {
    const { svc, prisma, usersService } = await montar();
    const passwordHash = await argon2.hash('x', { type: argon2.argon2id });
    usersService.findForAuthById.mockResolvedValue({
      id: USUARIO,
      username: 'gaspare',
      passwordHash,
      role: 'ADMIN',
    });
    prisma.user.count.mockResolvedValue(0);
    const erro = await svc.excluirConta(USUARIO, 'gaspare', 'x').catch((e) => e);
    expect(erro).toBeInstanceOf(ForbiddenException);
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });
});

/**
 * ─── TOMADA DE CONTA PELO VÍNCULO OAUTH ─────────────────────────────────────
 *
 * O cadastro por senha não confirma o e-mail. O invasor cadastrava o endereço
 * da vítima; quando ela entrava pelo Google, a conta era vinculada e
 * confirmada — e o invasor seguia entrando com a senha dele e com as sessões
 * que já tinha.
 */
describe('AuthService.validateOAuthUser — vínculo a uma conta de senha', () => {
  const contaDeSenha = (extra: Record<string, unknown> = {}) => ({
    id: USUARIO,
    email: 'vitima@exemplo.com',
    username: 'vitima',
    passwordHash: 'hash-de-quem-cadastrou',
    emailVerifiedAt: null,
    deletedAt: null,
    suspendedUntil: null,
    ...extra,
  });

  it('conta nunca confirmada: apaga a senha e derruba as sessões na mesma escrita', async () => {
    const { svc, prisma } = await montar();
    prisma.user.findUnique.mockResolvedValue(contaDeSenha());

    await svc.validateOAuthUser(
      'GOOGLE',
      'google-123',
      'vitima@exemplo.com',
      'vitima',
      'Vítima',
      true,
    );

    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    const { data } = prisma.user.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data).toEqual({
      emailVerifiedAt: expect.any(Date),
      passwordHash: null,
      tokensValidosApos: expect.any(Date),
    });
    expect(prisma.account.create).toHaveBeenCalledWith({
      data: { userId: USUARIO, provider: 'GOOGLE', providerAccountId: 'google-123' },
    });
  });

  it('conta já confirmada guarda a senha: ela foi criada depois de provar o e-mail', async () => {
    const { svc, prisma } = await montar();
    prisma.user.findUnique.mockResolvedValue(contaDeSenha({ emailVerifiedAt: new Date() }));

    await svc.validateOAuthUser('DISCORD', 'd-1', 'vitima@exemplo.com', 'vitima', 'V', true);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.account.create).toHaveBeenCalled();
  });

  it('conta sem senha e sem confirmação só ganha a confirmação', async () => {
    const { svc, prisma } = await montar();
    prisma.user.findUnique.mockResolvedValue(contaDeSenha({ passwordHash: null }));

    await svc.validateOAuthUser('GOOGLE', 'g-2', 'vitima@exemplo.com', 'vitima', 'V', true);

    const { data } = prisma.user.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(data).toEqual({ emailVerifiedAt: expect.any(Date) });
  });
});

describe('AuthService.excluirConta — denúncia em aberto segura a exclusão', () => {
  it('com denúncia aberta ou em análise, é 409 e nada é apagado', async () => {
    const { svc, prisma } = await montar();
    prisma.report.count.mockResolvedValue(1);

    const erro = await svc.excluirConta(USUARIO, 'gaspare', 'senha-atual-correta').catch((e) => e);

    expect(erro).toBeInstanceOf(ConflictException);
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(prisma.report.count).toHaveBeenCalledWith({
      where: {
        reportedId: USUARIO,
        status: { in: [ReportStatus.OPEN, ReportStatus.REVIEWING] },
      },
    });
  });

  it('o administrador conta e apaga numa transação serializável', async () => {
    const { svc, prisma, usersService } = await montar();
    const passwordHash = await argon2.hash('x', { type: argon2.argon2id });
    usersService.findForAuthById.mockResolvedValue({
      id: USUARIO,
      username: 'gaspare',
      passwordHash,
      role: 'ADMIN',
    });
    prisma.user.count.mockResolvedValue(2);

    await svc.excluirConta(USUARIO, 'gaspare', 'x');

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: USUARIO } });
  });
});

describe('AuthService.login — sem conta, o mesmo trabalho de conferir a senha', () => {
  beforeEach(() => {
    (argon2.verify as jest.Mock).mockClear();
  });

  it('e-mail sem cadastro também passa por um argon2.verify', async () => {
    const { svc } = await montar();

    const erro = await svc.login('ninguem@exemplo.com', 'chute').catch((e) => e);

    expect(erro).toBeInstanceOf(UnauthorizedException);
    expect(argon2.verify).toHaveBeenCalledTimes(1);
  });

  it('conta só de OAuth (sem senha) também', async () => {
    const { svc, usersService } = await montar();
    usersService.findForAuthByEmail.mockResolvedValue({
      id: USUARIO,
      username: 'gaspare',
      passwordHash: null,
    });

    await expect(svc.login('a@exemplo.com', 'chute')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(argon2.verify).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.register — username sem diferenciar maiúsculas', () => {
  it('a disponibilidade é conferida com `mode: insensitive`', async () => {
    const { svc, prisma } = await montar();
    prisma.user.create.mockResolvedValue({ id: USUARIO, username: 'Gaspare', passwordHash: 'h' });

    await svc.register('novo@exemplo.com', 'Gaspare', 'senha-123456');

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { username: { equals: 'Gaspare', mode: 'insensitive' } },
      }),
    );
  });
});
