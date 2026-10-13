/**
 * explorar.service.ts — decks públicos, para qualquer conta ver, curtir e copiar.
 *
 * `Deck.isPublic` existia com índice e nenhuma rota o lia (DOC-094 II.8):
 * marcar um deck como público não mudava nada para ninguém. Este serviço é o
 * outro lado do interruptor "Público" do editor.
 *
 * ─── O QUE É PÚBLICO, E O QUE NÃO É ────────────────────────────────────────
 *
 * Só sai daqui deck com `isPublic` de conta ATIVA (`deletedAt: null`): excluir
 * a conta tira os decks dela do Explorar no mesmo instante, sem esperar o
 * expurgo. O dono aparece pelo nome de usuário — o mesmo que o perfil público
 * já mostra —, nunca por e-mail ou id.
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { DecksService } from './decks.service.js';
import type { FiltrosDoExplorar } from './explorar.dto.js';

/** Cartões por página. Uma grade de 4 colunas × 6 linhas. */
export const POR_PAGINA = 24;

@Injectable()
export class ExplorarService {
  constructor(
    private prisma: PrismaService,
    private decks: DecksService,
  ) {}

  async listar(userId: string, filtros: FiltrosDoExplorar) {
    const where: Prisma.DeckWhereInput = {
      isPublic: true,
      user: { deletedAt: null },
      ...(filtros.busca ? { name: { contains: filtros.busca, mode: 'insensitive' } } : {}),
      ...(filtros.formato ? { formatId: filtros.formato } : {}),
      ...(filtros.curtidos ? { likes: { some: { userId } } } : {}),
    };
    const orderBy: Prisma.DeckOrderByWithRelationInput[] =
      filtros.ordem === 'recentes'
        ? [{ updatedAt: 'desc' }]
        : [{ likeCount: 'desc' }, { updatedAt: 'desc' }];

    const [total, linhas] = await this.prisma.$transaction([
      this.prisma.deck.count({ where }),
      this.prisma.deck.findMany({
        where,
        orderBy,
        skip: (filtros.pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
        select: {
          id: true,
          name: true,
          description: true,
          formatId: true,
          commanderId: true,
          partnerId: true,
          colorIdentity: true,
          cardCount: true,
          likeCount: true,
          updatedAt: true,
          user: { select: { username: true } },
          // Só a curtida DE QUEM PEDE: é o que acende o coração no cartão.
          likes: { where: { userId }, select: { userId: true } },
        },
      }),
    ]);

    return {
      total,
      pagina: filtros.pagina,
      porPagina: POR_PAGINA,
      decks: linhas.map(({ user, likes, ...d }) => ({
        ...d,
        dono: user.username,
        curtido: likes.length > 0,
      })),
    };
  }

  /**
   * Um deck público, hidratado como no editor.
   *
   * A hidratação é a do `DecksService.getDeckById`, chamada em nome do DONO:
   * reescrevê-la aqui seria a terceira cópia do lote da Scryfall, e as duas
   * primeiras já tinham divergido uma vez (ver o cabeçalho de decks.service).
   */
  async ver(userId: string, deckId: string) {
    const deck = await this.exigirPublico(deckId);
    const completo = await this.decks.getDeckById(deck.userId, deckId);
    const curtida = await this.prisma.deckLike.findUnique({
      where: { deckId_userId: { deckId, userId } },
      select: { userId: true },
    });
    // O `userId` do dono não sai: quem vê o deck precisa do nome, não do id.
    const { userId: _dono, ...publico } = completo;
    return { ...publico, dono: deck.user.username, curtido: Boolean(curtida) };
  }

  /**
   * Curtir e descurtir, com o contador na MESMA transação.
   *
   * `createMany` com `skipDuplicates` e `deleteMany` devolvem quantas linhas
   * mudaram: o contador anda só quando a curtida de fato nasceu ou morreu. Dois
   * cliques simultâneos em "curtir" criam UMA curtida e somam UM — a chave
   * composta decide, e não um "já curtiu?" lido antes, que perderia a corrida.
   */
  async curtir(userId: string, deckId: string, curtir: boolean) {
    const deck = await this.exigirPublico(deckId);
    if (deck.userId === userId) {
      throw new BadRequestException('Não dá para curtir o próprio deck.');
    }

    const likeCount = await this.prisma.$transaction(async (tx) => {
      const mudou = curtir
        ? (await tx.deckLike.createMany({ data: [{ deckId, userId }], skipDuplicates: true })).count
        : (await tx.deckLike.deleteMany({ where: { deckId, userId } })).count;
      if (mudou === 0) {
        const atual = await tx.deck.findUnique({
          where: { id: deckId },
          select: { likeCount: true },
        });
        return atual?.likeCount ?? 0;
      }
      const atualizado = await tx.deck.update({
        where: { id: deckId },
        data: { likeCount: curtir ? { increment: 1 } : { decrement: 1 } },
        select: { likeCount: true },
      });
      return atualizado.likeCount;
    });

    return { curtido: curtir, likeCount };
  }

  /**
   * Copiar um deck público para a própria conta.
   *
   * É o "jogar este deck" do Explorar: o original continua do dono, e a cópia
   * nasce PRIVADA na conta de quem copiou — editar a cópia não mexe no deck de
   * ninguém. Copiar o próprio deck é o "clonar" do editor, e vai por lá.
   */
  async copiar(userId: string, deckId: string) {
    const deck = await this.exigirPublico(deckId);
    const original = await this.prisma.deck.findUnique({
      where: { id: deckId },
      include: { cards: true },
    });
    if (!original) throw new NotFoundException('Deck não encontrado');

    return this.prisma.$transaction(async (tx) => {
      const novo = await tx.deck.create({
        data: {
          userId,
          name: `${original.name} (de ${deck.user.username})`.slice(0, 80),
          description: original.description,
          formatId: original.formatId,
          commanderId: original.commanderId,
          partnerId: original.partnerId,
          colorIdentity: original.colorIdentity,
          cardCount: original.cardCount,
        },
      });
      if (original.cards.length > 0) {
        await tx.deckCard.createMany({
          data: original.cards.map((c) => ({
            deckId: novo.id,
            scryfallId: c.scryfallId,
            quantity: c.quantity,
            boardType: c.boardType,
          })),
        });
      }
      return novo;
    });
  }

  /** O deck existe, é público e o dono está ativo — ou é 404, sem distinguir. */
  private async exigirPublico(deckId: string) {
    const deck = await this.prisma.deck.findFirst({
      where: { id: deckId, isPublic: true, user: { deletedAt: null } },
      select: { id: true, userId: true, user: { select: { username: true } } },
    });
    // A mesma resposta para "não existe" e "é privado": a rota não pode virar
    // um oráculo que confirma a existência de decks alheios.
    if (!deck) throw new NotFoundException('Deck não encontrado');
    return deck;
  }
}
