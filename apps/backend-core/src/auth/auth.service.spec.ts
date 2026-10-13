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

import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service.js';

const USUARIO = '0b6c1f9e-3a5d-4c2b-9e8f-1a2b3c4d5e6f';

async function montar(existentes: { email?: boolean; username?: boolean } = {}) {
  const passwordHash = await argon2.hash('senha-atual-correta', { type: argon2.argon2id });
  const usersService = {
    findForAuthById: jest
      .fn()
      .mockResolvedValue({ id: USUARIO, username: 'gaspare', passwordHash }),
  };
  const prisma = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { email?: string; username?: string } }) => {
        if (where.email && existentes.email) return { id: 'outro' };
        if (where.username && existentes.username) return { id: 'outro' };
        return null;
      }),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
    },
  };
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

describe('AuthService.excluirConta — a pessoa sai sem precisar de um administrador', () => {
  it('com nome e senha certos, desativa a conta e derruba TODAS as sessões', async () => {
    const { svc, prisma } = await montar();

    await svc.excluirConta(USUARIO, 'gaspare', 'senha-atual-correta');

    const dados = prisma.user.update.mock.calls[0]![0].data;
    expect(dados.deletedAt).toBeInstanceOf(Date);
    // O mesmo instante: o token de quem pediu também cai.
    expect(dados.tokensValidosApos).toBe(dados.deletedAt);
  });

  it('senha errada é 400 e não apaga nada', async () => {
    const { svc, prisma } = await montar();
    const erro = await svc.excluirConta(USUARIO, 'gaspare', 'chute').catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('o nome digitado precisa ser o exato da conta', async () => {
    const { svc, prisma } = await montar();
    const erro = await svc.excluirConta(USUARIO, 'Gaspare', 'senha-atual-correta').catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('conta de Google/Discord (sem senha) se exclui só com a confirmação', async () => {
    const { svc, prisma, usersService } = await montar();
    usersService.findForAuthById.mockResolvedValue({
      id: USUARIO,
      username: 'gaspare',
      passwordHash: null,
    });
    await svc.excluirConta(USUARIO, 'gaspare');
    expect(prisma.user.update).toHaveBeenCalled();
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
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
