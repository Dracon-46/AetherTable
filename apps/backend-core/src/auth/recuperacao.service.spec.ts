/**
 * recuperacao.service.spec.ts — o link de redefinição vale UMA vez, mesmo em corrida.
 *
 * ─── O DEFEITO ──────────────────────────────────────────────────────────────
 *
 * O uso único era conferido na LEITURA e a marcação de usado era um `update`
 * incondicional. Duas requisições com o mesmo link liam `usedAt` nulo ao mesmo
 * tempo e as duas trocavam a senha — a vítima e quem leu a mesma caixa de
 * entrada, por exemplo. Ganhava a última.
 *
 * O duplo do Prisma reproduz o que o Postgres garante e o código precisa usar:
 * um `updateMany` cujo WHERE é reavaliado sobre o estado ATUAL da linha. Sem
 * banco de verdade.
 */

import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

/**
 * O argon2 de verdade fica de fora: ele é caro de propósito (memória e CPU), e
 * dois hashes em paralelo, com as outras suítes rodando junto, estouravam os
 * 5 s do jest — o teste falhava de vez em quando sem que nada estivesse
 * errado. O que se prova aqui é o consumo atômico do link, não o hash.
 */
jest.mock('argon2', () => ({
  hash: jest.fn(async () => 'hash-falso'),
  argon2id: 2,
}));

import { RecuperacaoService, TokenDeRedefinicaoInvalido } from './recuperacao.service.js';
import { hashDoToken } from './token-de-redefinicao.js';

const TOKEN = 'token-de-teste-com-entropia-suficiente-0123456789abcdef';
const USUARIO = '0b6c1f9e-3a5d-4c2b-9e8f-1a2b3c4d5e6f';

function montar() {
  const linha = {
    tokenHash: hashDoToken(TOKEN),
    userId: USUARIO,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    usedAt: null as Date | null,
  };

  const prisma = {
    passwordResetToken: {
      findUnique: jest.fn(async () => ({ ...linha })),
      // Condicional como no Postgres: só consome se AINDA não foi usado.
      updateMany: jest.fn(
        async ({ where, data }: { where: { usedAt: null }; data: { usedAt: Date } }) => {
          if (where.usedAt === null && linha.usedAt !== null) return { count: 0 };
          linha.usedAt = data.usedAt;
          return { count: 1 };
        },
      ),
      // O caminho antigo: marca sem condição nenhuma.
      update: jest.fn(async ({ data }: { data: { usedAt: Date } }) => {
        linha.usedAt = data.usedAt;
        return { ...linha };
      }),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    user: {
      findFirst: jest.fn(async (): Promise<{ id: string; emailVerifiedAt: Date | null }> => ({
        id: USUARIO,
        emailVerifiedAt: null,
      })),
      update: jest.fn(async () => ({ id: USUARIO })),
    },
    $transaction: jest.fn(async (arg: unknown): Promise<unknown> => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (tx: unknown) => Promise<unknown>)(transacao);
    }),
  };
  const transacao: unknown = prisma;

  const svc = new RecuperacaoService(prisma as never, {} as never, {} as ConfigService);
  return { svc, prisma, linha };
}

describe('RecuperacaoService.redefinir — uso único atômico', () => {
  it('dois envios simultâneos do mesmo link: só UM troca a senha', async () => {
    const { svc, prisma } = montar();

    const resultados = await Promise.allSettled([
      svc.redefinir(TOKEN, 'senha-nova-numero-um'),
      svc.redefinir(TOKEN, 'senha-nova-numero-dois'),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const recusado = resultados.find((r) => r.status === 'rejected')!;
    expect(recusado.reason).toBeInstanceOf(TokenDeRedefinicaoInvalido);
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('o consumo exige token ainda não usado e não vencido no próprio WHERE', async () => {
    const { svc, prisma } = montar();

    await svc.redefinir(TOKEN, 'senha-nova-valida');

    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ usedAt: null, expiresAt: { gt: expect.any(Date) } }),
      }),
    );
  });

  it('a troca de senha corta as sessões, como antes', async () => {
    const { svc, prisma } = montar();

    await svc.redefinir(TOKEN, 'senha-nova-valida');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokensValidosApos: expect.any(Date) }),
      }),
    );
  });

  /**
   * Abrir o link prova a posse do e-mail. Sem gravar isso, o primeiro "Entrar
   * com Google" apagaria a senha que o dono acabou de escolher (o vínculo trata
   * a senha de conta não confirmada como suspeita).
   */
  it('confirma o e-mail de quem ainda não tinha confirmado', async () => {
    const { svc, prisma } = montar();

    await svc.redefinir(TOKEN, 'senha-nova-valida');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ emailVerifiedAt: expect.any(Date) }),
      }),
    );
  });

  it('não reescreve a data de quem já tinha confirmado', async () => {
    const { svc, prisma } = montar();
    prisma.user.findFirst.mockResolvedValue({ id: USUARIO, emailVerifiedAt: new Date(0) });

    await svc.redefinir(TOKEN, 'senha-nova-valida');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ emailVerifiedAt: expect.anything() }),
      }),
    );
  });

  it('link já usado continua recusado na leitura', async () => {
    const { svc, linha, prisma } = montar();
    linha.usedAt = new Date();

    await expect(svc.redefinir(TOKEN, 'senha-nova-valida')).rejects.toBeInstanceOf(
      TokenDeRedefinicaoInvalido,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('RecuperacaoService.solicitar', () => {
  function montarPedido(opcoes: {
    producao?: boolean;
    configurado?: boolean;
    conta?: { passwordHash: string | null } | null;
  }) {
    const conta =
      opcoes.conta === null
        ? null
        : {
            id: USUARIO,
            email: 'dono@exemplo.com',
            username: 'dono',
            passwordHash: 'hash',
            ...opcoes.conta,
          };
    const prisma = {
      user: { findFirst: jest.fn().mockResolvedValue(conta) },
      passwordResetToken: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const email = {
      configurado: opcoes.configurado ?? true,
      enviar: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      get: (chave: string) =>
        chave === 'NODE_ENV'
          ? opcoes.producao
            ? 'production'
            : 'development'
          : chave === 'FRONTEND_URL'
            ? 'https://mesa.exemplo.com'
            : undefined,
    } as unknown as ConfigService;
    const svc = new RecuperacaoService(prisma as never, email as never, config);
    return { svc, prisma, email };
  }

  /**
   * Em produção sem chave, o `EmailService` recusava e `enviarComSeguranca`
   * engolia: a tela prometia um e-mail que nunca saía.
   */
  it('produção sem e-mail configurado: 503 antes de procurar a conta', async () => {
    const { svc, prisma } = montarPedido({ producao: true, configurado: false });

    await expect(svc.solicitar('dono@exemplo.com')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    // Antes da busca: a resposta é a mesma para e-mail cadastrado ou não.
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('fora de produção, sem chave, segue — o link vai para o log', async () => {
    const { svc, email } = montarPedido({ producao: false, configurado: false });
    await expect(svc.solicitar('dono@exemplo.com')).resolves.toBeUndefined();
    expect(email.enviar).toHaveBeenCalled();
  });

  /**
   * Conta só de Google/Discord — inclusive a que perdeu a senha no vínculo
   * OAuth (`AuthService.validateOAuthUser`) — recebe o link: abri-lo prova a
   * posse do e-mail, e é o único jeito de ela voltar a ter senha.
   */
  it('conta sem senha recebe um link de verdade para criar uma', async () => {
    const { svc, prisma, email } = montarPedido({ conta: { passwordHash: null } });

    await svc.solicitar('dono@exemplo.com');

    expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
    const msg = email.enviar.mock.calls[0]![0] as { texto: string; assunto: string };
    expect(msg.texto).toContain('https://mesa.exemplo.com/');
    expect(msg.texto).toContain('?token=');
    expect(msg.assunto).toMatch(/criar uma senha/i);
  });

  it('conta inexistente: nada é enviado, e nada é dito', async () => {
    const { svc, email } = montarPedido({ conta: null });
    await expect(svc.solicitar('ninguem@exemplo.com')).resolves.toBeUndefined();
    expect(email.enviar).not.toHaveBeenCalled();
  });
});
