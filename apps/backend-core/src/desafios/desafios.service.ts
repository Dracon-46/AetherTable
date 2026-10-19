/**
 * desafios.service.ts — o progresso dos desafios (os minigames), por conta.
 *
 * O recorde vivia no `localStorage` e a sequência num `useState`: trocar de
 * PC zerava o recorde, e um F5 zerava a sequência. Aqui os dois passam a
 * morar na conta, uma linha de `progresso_de_desafios` por desafio.
 *
 * ─── O RECORDE SÓ SOBE, E QUEM GARANTE É O BANCO ───────────────────────────
 *
 * O cliente nunca manda o recorde: manda a sequência, e o recorde é
 * consequência dela. A subida é um `UPDATE ... WHERE recorde < :sequencia` —
 * condicional e atômico no Postgres. Ler o recorde, comparar no Node e
 * regravar perderia para duas abas respondendo ao mesmo tempo: as duas leriam
 * 7, uma gravaria 9, a outra gravaria 8 por cima. Com a condição no `WHERE`,
 * a ordem não importa e vale o maior.
 *
 * Sem SQL cru: o projeto não usa `$queryRaw`, e `updateMany` com filtro
 * expressa a mesma condição pelo Prisma.
 *
 * ─── A PERGUNTA ABERTA (`emJogo`) ──────────────────────────────────────────
 *
 * A sequência sobrevivendo ao F5 abriu um atalho: diante de uma pergunta
 * difícil, recarregar a página sortearia outra sem perder a sequência. Por
 * isso o cliente avisa quando SORTEIA (`emJogo: true`) e quando RESPONDE
 * (`emJogo: false`). Ao abrir um desafio com `emJogo: true`, a pergunta
 * anterior foi abandonada — por F5, por fechar a aba, por trocar de PC — e a
 * sequência zera, como se a pessoa tivesse errado. A regra mora no cliente
 * (é ele que sabe quando uma pergunta começa); o servidor guarda o fato.
 */

import { BadRequestException, Injectable } from '@nestjs/common';
import {
  MAX_DESAFIOS_POR_CONTA,
  type ProgressoDeDesafio,
  type ProgressoDosDesafios,
} from '@aethertable/shared-types';
import { PrismaService } from '../common/prisma/prisma.service.js';

@Injectable()
export class DesafiosService {
  constructor(private readonly prisma: PrismaService) {}

  /** `GET /users/me/desafios`: `{ [chave]: { recorde, sequencia, emJogo } }`. */
  async listar(userId: string): Promise<ProgressoDosDesafios> {
    const linhas = await this.prisma.progressoDeDesafio.findMany({
      where: { userId },
      select: { chave: true, recorde: true, sequencia: true, emJogo: true },
      orderBy: { chave: 'asc' },
    });
    return Object.fromEntries(
      linhas.map(({ chave, recorde, sequencia, emJogo }) => [
        chave,
        { recorde, sequencia, emJogo },
      ]),
    );
  }

  /**
   * `PUT /users/me/desafios/:chave`: grava a sequência e a pergunta aberta, e
   * sobe o recorde se a sequência passou dele.
   *
   * Dois comandos na MESMA transação: o `upsert` cria a linha na primeira
   * jogada (nasce com `recorde = sequencia`) ou grava a sequência; o
   * `updateMany` condicional sobe o recorde. Ver o cabeçalho.
   */
  async registrar(
    userId: string,
    chave: string,
    { sequencia, emJogo }: { sequencia: number; emJogo: boolean },
  ): Promise<ProgressoDeDesafio> {
    await this.exigirVaga(userId, [chave]);

    const [linha] = await this.prisma.$transaction([
      this.prisma.progressoDeDesafio.upsert({
        where: { userId_chave: { userId, chave } },
        create: { userId, chave, sequencia, emJogo, recorde: sequencia },
        update: { sequencia, emJogo },
        select: { recorde: true },
      }),
      this.prisma.progressoDeDesafio.updateMany({
        where: { userId, chave, recorde: { lt: sequencia } },
        data: { recorde: sequencia },
      }),
    ]);

    // O `upsert` devolve o recorde de ANTES da subida; o `updateMany` só o
    // troca se a sequência for maior. O que ficou no banco é o maior dos dois.
    return { recorde: Math.max(linha.recorde, sequencia), sequencia, emJogo };
  }

  /**
   * `POST /users/me/desafios/importar`: sobe os recordes que o navegador
   * guardava antes de o progresso ir para a conta.
   *
   * `recorde = max(atual, enviado)`, e a sequência NÃO é tocada: o navegador
   * antigo nunca guardou sequência, e um recorde importado não diz nada sobre
   * a partida em curso. O cliente chama isto uma vez por navegador e depois
   * apaga as chaves antigas; chamar de novo é inofensivo, porque o máximo de
   * um valor com ele mesmo é ele mesmo.
   *
   * `createMany` com `skipDuplicates` é um `INSERT ... ON CONFLICT DO
   * NOTHING`: cria as linhas que faltam sem tocar nas que existem. A subida,
   * como no `registrar`, é o `UPDATE` condicional.
   */
  async importar(userId: string, recordes: Record<string, number>): Promise<ProgressoDosDesafios> {
    const entradas = Object.entries(recordes);
    await this.exigirVaga(
      userId,
      entradas.map(([chave]) => chave),
    );

    await this.prisma.$transaction([
      this.prisma.progressoDeDesafio.createMany({
        data: entradas.map(([chave, recorde]) => ({ userId, chave, recorde })),
        skipDuplicates: true,
      }),
      ...entradas.map(([chave, recorde]) =>
        this.prisma.progressoDeDesafio.updateMany({
          where: { userId, chave, recorde: { lt: recorde } },
          data: { recorde },
        }),
      ),
    ]);

    return this.listar(userId);
  }

  /**
   * ─── O TETO DE CHAVES POR CONTA ───────────────────────────────────────────
   *
   * A chave é texto livre dentro do formato, e cada uma é uma linha. Sem teto,
   * um script autenticado encheria a tabela com `a1`, `a2`, `a3`… São cinco
   * desafios hoje; 64 é folga para muitos anos.
   *
   * Só a chave NOVA é barrada: uma conta no teto continua gravando progresso
   * nos desafios que já tem. Duas chaves novas chegando juntas na 64ª podem
   * passar as duas — o teto é contra depósito, não contabilidade, e o
   * throttle limita quantas chegam juntas.
   */
  private async exigirVaga(userId: string, chaves: string[]): Promise<void> {
    const existentes = await this.prisma.progressoDeDesafio.findMany({
      where: { userId },
      select: { chave: true },
    });
    const conhecidas = new Set(existentes.map((e) => e.chave));
    const novas = new Set(chaves.filter((c) => !conhecidas.has(c)));
    if (novas.size > 0 && conhecidas.size + novas.size > MAX_DESAFIOS_POR_CONTA) {
      throw new BadRequestException(
        `Uma conta guarda progresso de no máximo ${MAX_DESAFIOS_POR_CONTA} desafios.`,
      );
    }
  }
}
