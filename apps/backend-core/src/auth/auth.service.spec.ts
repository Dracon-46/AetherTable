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

import { BadRequestException, ConflictException } from '@nestjs/common';
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
  return { svc, prisma };
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
