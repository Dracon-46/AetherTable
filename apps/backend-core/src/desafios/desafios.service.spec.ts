/**
 * desafios.service.spec.ts — o progresso dos desafios na conta.
 *
 * O que estes casos fixam: o recorde só sobe (e a subida é um UPDATE
 * condicional, não uma conta feita no Node); a pergunta aberta (`emJogo`) é
 * gravada como veio; a 65ª chave NOVA é recusada, mas as existentes seguem
 * gravando; a importação do navegador faz `max(atual, enviado)` sem tocar na
 * sequência.
 *
 * O PrismaService é um dublê EM MEMÓRIA que entende só o que o serviço usa —
 * `findMany`, `upsert`, `updateMany` com `recorde: { lt }`, `createMany` com
 * `skipDuplicates` —, para os casos testarem o efeito na tabela e não a
 * forma de cada chamada.
 */

import { BadRequestException } from '@nestjs/common';
import { MAX_DESAFIOS_POR_CONTA } from '@aethertable/shared-types';
import { DesafiosService } from './desafios.service.js';
import { ChaveDeDesafioParam, ImportarRecordesDto, RegistrarProgressoDto } from './desafios.dto.js';

interface Linha {
  userId: string;
  chave: string;
  recorde: number;
  sequencia: number;
  emJogo: boolean;
}

interface Onde {
  userId: string;
  chave?: string;
  recorde?: { lt: number };
}

function montar(inicial: Linha[] = []) {
  const tabela: Linha[] = inicial.map((l) => ({ ...l }));
  const casa = (l: Linha, w: Onde) =>
    l.userId === w.userId &&
    (w.chave === undefined || l.chave === w.chave) &&
    (w.recorde === undefined || l.recorde < w.recorde.lt);

  const progressoDeDesafio = {
    findMany: jest.fn(async ({ where }: { where: Onde }) =>
      tabela
        .filter((l) => casa(l, where))
        .sort((a, b) => a.chave.localeCompare(b.chave))
        .map((l) => ({ ...l })),
    ),
    upsert: jest.fn(
      async ({
        where,
        create,
        update,
      }: {
        where: { userId_chave: { userId: string; chave: string } };
        create: Partial<Linha> & Pick<Linha, 'userId' | 'chave'>;
        update: Partial<Linha>;
      }) => {
        const { userId, chave } = where.userId_chave;
        const achada = tabela.find((l) => l.userId === userId && l.chave === chave);
        if (achada) {
          Object.assign(achada, update);
          return { ...achada };
        }
        const nova = { recorde: 0, sequencia: 0, emJogo: false, ...create };
        tabela.push(nova);
        return { ...nova };
      },
    ),
    updateMany: jest.fn(async ({ where, data }: { where: Onde; data: Partial<Linha> }) => {
      const alvo = tabela.filter((l) => casa(l, where));
      alvo.forEach((l) => Object.assign(l, data));
      return { count: alvo.length };
    }),
    createMany: jest.fn(async ({ data }: { data: Omit<Linha, 'sequencia' | 'emJogo'>[] }) => {
      let count = 0;
      for (const d of data) {
        if (tabela.some((l) => l.userId === d.userId && l.chave === d.chave)) continue;
        tabela.push({ sequencia: 0, emJogo: false, ...d });
        count += 1;
      }
      return { count };
    }),
  };

  const prisma = {
    progressoDeDesafio,
    // Os dublês executam na chamada; a transação só espera todos, na ordem.
    $transaction: jest.fn(async (operacoes: Promise<unknown>[]) => Promise.all(operacoes)),
  };
  return { svc: new DesafiosService(prisma as never), prisma, tabela };
}

const linha = (chave: string, p: Partial<Linha> = {}): Linha => ({
  userId: 'u1',
  chave,
  recorde: 0,
  sequencia: 0,
  emJogo: false,
  ...p,
});

describe('DesafiosService.registrar — o recorde só sobe', () => {
  it('a primeira jogada cria a linha com recorde = sequência', async () => {
    const { svc, tabela } = montar();
    const r = await svc.registrar('u1', 'mais-cara', { sequencia: 3, emJogo: false });
    expect(r).toEqual({ recorde: 3, sequencia: 3, emJogo: false });
    expect(tabela).toEqual([linha('mais-cara', { recorde: 3, sequencia: 3 })]);
  });

  it('sequência acima do recorde sobe o recorde', async () => {
    const { svc, tabela } = montar([linha('escada', { recorde: 5, sequencia: 5 })]);
    const r = await svc.registrar('u1', 'escada', { sequencia: 8, emJogo: false });
    expect(r.recorde).toBe(8);
    expect(tabela[0]!.recorde).toBe(8);
  });

  it('errar zera a sequência e NÃO derruba o recorde', async () => {
    const { svc, tabela } = montar([linha('escada', { recorde: 12, sequencia: 12 })]);
    const r = await svc.registrar('u1', 'escada', { sequencia: 0, emJogo: false });
    expect(r).toEqual({ recorde: 12, sequencia: 0, emJogo: false });
    expect(tabela[0]).toMatchObject({ recorde: 12, sequencia: 0 });
  });

  it('a subida é um UPDATE condicional no banco, e não uma conta no Node', async () => {
    // Ler, comparar e regravar perderia para duas abas respondendo juntas.
    // A condição no WHERE é o que faz o banco ficar com o maior.
    const { svc, prisma } = montar();
    await svc.registrar('u1', 'grade', { sequencia: 4, emJogo: false });
    expect(prisma.progressoDeDesafio.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', chave: 'grade', recorde: { lt: 4 } },
      data: { recorde: 4 },
    });
    // E o upsert nunca escreve o recorde de uma linha que já existe.
    const { update } = prisma.progressoDeDesafio.upsert.mock.calls[0]![0];
    expect(update).not.toHaveProperty('recorde');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('duas respostas fora de ordem: fica o maior', async () => {
    const { svc, tabela } = montar();
    await svc.registrar('u1', 'adivinhe', { sequencia: 9, emJogo: false });
    await svc.registrar('u1', 'adivinhe', { sequencia: 4, emJogo: false });
    expect(tabela[0]).toMatchObject({ recorde: 9, sequencia: 4 });
  });

  it('não mexe no progresso de outra conta', async () => {
    const { svc, tabela } = montar([linha('grade', { userId: 'u2', recorde: 7 })]);
    await svc.registrar('u1', 'grade', { sequencia: 2, emJogo: false });
    expect(tabela.find((l) => l.userId === 'u2')!.recorde).toBe(7);
  });
});

describe('DesafiosService.registrar — a pergunta aberta', () => {
  it('sortear grava emJogo: true sem mexer na sequência', async () => {
    const { svc, tabela } = montar([linha('mais-jogada', { recorde: 6, sequencia: 4 })]);
    const r = await svc.registrar('u1', 'mais-jogada', { sequencia: 4, emJogo: true });
    expect(r).toEqual({ recorde: 6, sequencia: 4, emJogo: true });
    expect(tabela[0]).toMatchObject({ sequencia: 4, emJogo: true });
  });

  it('responder fecha a pergunta (emJogo: false)', async () => {
    const { svc, tabela } = montar([linha('mais-jogada', { sequencia: 4, emJogo: true })]);
    await svc.registrar('u1', 'mais-jogada', { sequencia: 5, emJogo: false });
    expect(tabela[0]).toMatchObject({ sequencia: 5, emJogo: false, recorde: 5 });
  });

  it('listar devolve o emJogo para o cliente aplicar a regra da pergunta abandonada', async () => {
    const { svc } = montar([
      linha('mais-jogada', { recorde: 6, sequencia: 4, emJogo: true }),
      linha('grade', { recorde: 9 }),
    ]);
    expect(await svc.listar('u1')).toEqual({
      grade: { recorde: 9, sequencia: 0, emJogo: false },
      'mais-jogada': { recorde: 6, sequencia: 4, emJogo: true },
    });
  });
});

describe(`teto de ${MAX_DESAFIOS_POR_CONTA} desafios por conta`, () => {
  const cheia = () =>
    Array.from({ length: MAX_DESAFIOS_POR_CONTA }, (_, i) => linha(`desafio-${i}`));

  it('a 65ª chave NOVA é 400 e não grava nada', async () => {
    const { svc, prisma, tabela } = montar(cheia());
    await expect(
      svc.registrar('u1', 'mais-uma', { sequencia: 1, emJogo: false }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tabela).toHaveLength(MAX_DESAFIOS_POR_CONTA);
  });

  it('no teto, uma chave que JÁ existe continua gravando', async () => {
    const { svc } = montar(cheia());
    const r = await svc.registrar('u1', 'desafio-3', { sequencia: 2, emJogo: false });
    expect(r.recorde).toBe(2);
  });

  it('a 64ª ainda entra', async () => {
    const { svc, tabela } = montar(cheia().slice(1));
    await svc.registrar('u1', 'a-ultima', { sequencia: 1, emJogo: false });
    expect(tabela).toHaveLength(MAX_DESAFIOS_POR_CONTA);
  });

  it('a importação que passaria do teto é recusada inteira', async () => {
    const { svc, prisma } = montar(cheia().slice(2));
    await expect(svc.importar('u1', { a: 1, b: 2, c: 3 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('DesafiosService.importar — o recorde do navegador sobe para a conta', () => {
  it('recorde = max(atual, enviado), e a sequência fica onde estava', async () => {
    const { svc } = montar([
      linha('escada', { recorde: 10, sequencia: 3, emJogo: true }),
      linha('grade', { recorde: 2, sequencia: 1 }),
    ]);
    const mapa = await svc.importar('u1', { escada: 7, grade: 6, adivinhe: 4 });
    expect(mapa).toEqual({
      // Menor que o da conta: fica o da conta.
      escada: { recorde: 10, sequencia: 3, emJogo: true },
      // Maior: sobe, sem tocar na sequência.
      grade: { recorde: 6, sequencia: 1, emJogo: false },
      // Novo: nasce só com o recorde.
      adivinhe: { recorde: 4, sequencia: 0, emJogo: false },
    });
  });

  it('importar duas vezes é inofensivo', async () => {
    const { svc } = montar();
    await svc.importar('u1', { adivinhe: 4 });
    expect(await svc.importar('u1', { adivinhe: 4 })).toEqual({
      adivinhe: { recorde: 4, sequencia: 0, emJogo: false },
    });
  });
});

describe('a borda dos desafios', () => {
  it('a chave é minúscula, número e hífen, até 40', () => {
    for (const ok of ['adivinhe', 'mais-jogada', 'a', 'x'.repeat(40), 'grade-2']) {
      expect(ChaveDeDesafioParam.safeParse(ok).success).toBe(true);
    }
    for (const ruim of ['', 'x'.repeat(41), 'Mais-Jogada', 'a b', '../users', 'ação', 'a_b']) {
      expect(ChaveDeDesafioParam.safeParse(ruim).success).toBe(false);
    }
  });

  it('a sequência é inteira, de 0 a 100 mil, e emJogo é obrigatório', () => {
    expect(RegistrarProgressoDto.safeParse({ sequencia: 0, emJogo: false }).success).toBe(true);
    expect(RegistrarProgressoDto.safeParse({ sequencia: 100_000, emJogo: true }).success).toBe(
      true,
    );
    for (const ruim of [
      { sequencia: -1, emJogo: false },
      { sequencia: 100_001, emJogo: false },
      { sequencia: 1.5, emJogo: false },
      { sequencia: '3', emJogo: false },
      { sequencia: 3 },
      { emJogo: true },
    ]) {
      expect(RegistrarProgressoDto.safeParse(ruim).success).toBe(false);
    }
  });

  it('o cliente não escolhe o próprio recorde: o campo é descartado', () => {
    const r = RegistrarProgressoDto.parse({ sequencia: 2, emJogo: false, recorde: 99_999 });
    expect(r).toEqual({ sequencia: 2, emJogo: false });
  });

  it('a importação aceita até 64 chaves válidas com placar inteiro', () => {
    const cheio = Object.fromEntries(
      Array.from({ length: MAX_DESAFIOS_POR_CONTA }, (_, i) => [`d-${i}`, i]),
    );
    expect(ImportarRecordesDto.safeParse(cheio).success).toBe(true);
    expect(ImportarRecordesDto.safeParse({ ...cheio, 'mais-um': 1 }).success).toBe(false);
    expect(ImportarRecordesDto.safeParse({}).success).toBe(false);
    expect(ImportarRecordesDto.safeParse({ 'Chave Ruim': 3 }).success).toBe(false);
    expect(ImportarRecordesDto.safeParse({ adivinhe: -2 }).success).toBe(false);
    expect(ImportarRecordesDto.safeParse({ adivinhe: 2.5 }).success).toBe(false);
    expect(ImportarRecordesDto.safeParse([1, 2]).success).toBe(false);
  });
});
