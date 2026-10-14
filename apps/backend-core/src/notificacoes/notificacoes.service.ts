/**
 * notificacoes.service.ts — o que aconteceu com a conta enquanto ela estava
 * fora.
 *
 * Não há tabela de notificações: cada aviso é DERIVADO de um registro que já
 * existe, na hora da leitura. Uma tabela a mais precisaria ser escrita por
 * cada ponto do sistema que gera um aviso — e o primeiro que esquecesse de
 * escrever viraria um aviso que nunca chega. Lido da fonte, não há como o
 * aviso e o fato divergirem.
 *
 * O que é "novo" é decidido pelo cliente (a última vez que a pessoa abriu o
 * sino): o servidor só devolve os últimos 30 dias.
 *
 * ─── CURTIDAS SEM NOMES ─────────────────────────────────────────────────────
 *
 * O Explorar mostra QUANTAS curtidas um deck tem, nunca QUEM curtiu. O sino
 * não pode revelar mais que isso: as curtidas vêm agregadas por deck.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service.js';

const DIA = 24 * 60 * 60 * 1000;
export const JANELA_EM_DIAS = 30;
const MAXIMO = 30;

export type Notificacao =
  | {
      tipo: 'CURTIDAS';
      em: Date;
      deckId: string;
      nomeDoDeck: string;
      quantas: number;
    }
  | {
      tipo: 'COMENTARIOS';
      em: Date;
      deckId: string;
      nomeDoDeck: string;
      quantos: number;
    }
  | {
      tipo: 'DENUNCIA_ANALISADA';
      em: Date;
      denunciaId: string;
      /** RESOLVED (houve medida) ou DISMISSED (não houve). O texto do moderador não sai daqui. */
      desfecho: 'RESOLVED' | 'DISMISSED';
    };

@Injectable()
export class NotificacoesService {
  constructor(private prisma: PrismaService) {}

  async listar(userId: string, agora = new Date()): Promise<Notificacao[]> {
    const desde = new Date(agora.getTime() - JANELA_EM_DIAS * DIA);

    const [curtidas, comentarios, denuncias] = await Promise.all([
      this.prisma.deckLike.findMany({
        // Curtir o próprio deck não é notícia para ninguém.
        where: { deck: { userId }, userId: { not: userId }, createdAt: { gte: desde } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { createdAt: true, deck: { select: { id: true, name: true } } },
      }),
      // Comentários nos MEUS decks, de outras pessoas. Agregados por deck
      // como as curtidas: o sino avisa e leva ao deck, onde a conversa está.
      this.prisma.deckComment.findMany({
        where: { deck: { userId }, userId: { not: userId }, createdAt: { gte: desde } },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select: { createdAt: true, deck: { select: { id: true, name: true } } },
      }),
      this.prisma.report.findMany({
        where: {
          reporterId: userId,
          resolvedAt: { gte: desde },
          status: { in: ['RESOLVED', 'DISMISSED'] },
        },
        orderBy: { resolvedAt: 'desc' },
        take: MAXIMO,
        select: { id: true, status: true, resolvedAt: true },
      }),
    ]);

    // Uma linha por deck: "recebeu 3 curtidas", datada pela mais recente.
    const porDeck = new Map<string, Extract<Notificacao, { tipo: 'CURTIDAS' }>>();
    for (const c of curtidas) {
      const atual = porDeck.get(c.deck.id);
      if (atual) atual.quantas += 1;
      else {
        porDeck.set(c.deck.id, {
          tipo: 'CURTIDAS',
          em: c.createdAt,
          deckId: c.deck.id,
          nomeDoDeck: c.deck.name,
          quantas: 1,
        });
      }
    }

    const comentadosPorDeck = new Map<string, Extract<Notificacao, { tipo: 'COMENTARIOS' }>>();
    for (const c of comentarios) {
      const atual = comentadosPorDeck.get(c.deck.id);
      if (atual) atual.quantos += 1;
      else {
        comentadosPorDeck.set(c.deck.id, {
          tipo: 'COMENTARIOS',
          em: c.createdAt,
          deckId: c.deck.id,
          nomeDoDeck: c.deck.name,
          quantos: 1,
        });
      }
    }

    const analisadas: Notificacao[] = denuncias.map((d) => ({
      tipo: 'DENUNCIA_ANALISADA',
      em: d.resolvedAt!,
      denunciaId: d.id,
      desfecho: d.status as 'RESOLVED' | 'DISMISSED',
    }));

    return [...porDeck.values(), ...comentadosPorDeck.values(), ...analisadas]
      .sort((a, b) => b.em.getTime() - a.em.getTime())
      .slice(0, MAXIMO);
  }
}
