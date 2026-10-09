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
      findFirst: jest.fn(async () => ({ id: USUARIO })),
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
    const recusado = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
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

  it('link já usado continua recusado na leitura', async () => {
    const { svc, linha, prisma } = montar();
    linha.usedAt = new Date();

    await expect(svc.redefinir(TOKEN, 'senha-nova-valida')).rejects.toBeInstanceOf(
      TokenDeRedefinicaoInvalido,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
