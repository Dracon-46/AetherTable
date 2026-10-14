/**
 * comentarios.service.ts — conversa embaixo de um deck público.
 *
 * Só deck PÚBLICO recebe comentário, pela mesma regra do Explorar: o que é
 * privado não existe para os outros, e a rota responde 404 igual para "não
 * existe" e "é privado".
 *
 * Quem pode apagar: o autor do comentário e o DONO do deck — é a casa dele.
 * Quem o dono bloqueou não comenta nos decks dele: o bloqueio já valia na mesa
 * (RN04), e um deck público não pode virar a porta dos fundos para a mesma
 * pessoa.
 *
 * O nome do autor vem da conta na leitura. Excluir a conta apaga os
 * comentários dela junto (CASCADE): quem pediu para ser esquecido não fica
 * falando nos decks dos outros.
 */

import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service.js';

/** Os mais recentes. Uma conversa de deck com mais que isso já virou fórum. */
export const MAX_COMENTARIOS = 100;

@Injectable()
export class ComentariosService {
  constructor(private prisma: PrismaService) {}

  async listar(userId: string, deckId: string) {
    const deck = await this.exigirPublico(deckId);
    const linhas = await this.prisma.deckComment.findMany({
      where: { deckId },
      orderBy: { createdAt: 'desc' },
      take: MAX_COMENTARIOS,
      select: {
        id: true,
        text: true,
        createdAt: true,
        userId: true,
        user: { select: { username: true, displayName: true } },
      },
    });
    // Do mais antigo para o mais novo: é como se lê uma conversa.
    return linhas.reverse().map((c) => ({
      id: c.id,
      texto: c.text,
      em: c.createdAt,
      autor: { usuario: c.user.username, nome: c.user.displayName || c.user.username },
      meu: c.userId === userId,
      podeApagar: c.userId === userId || deck.userId === userId,
    }));
  }

  async comentar(userId: string, deckId: string, texto: string) {
    const deck = await this.exigirPublico(deckId);
    if (deck.userId !== userId) {
      const bloqueado = await this.prisma.block.findUnique({
        where: { blockerId_blockedId: { blockerId: deck.userId, blockedId: userId } },
        select: { blockerId: true },
      });
      // A mensagem não diz "você foi bloqueado": isso seria contar à pessoa
      // bloqueada o que o bloqueio existe para não dizer.
      if (bloqueado) throw new ForbiddenException('Não é possível comentar neste deck.');
    }
    const c = await this.prisma.deckComment.create({
      data: { deckId, userId, text: texto },
      select: { id: true, createdAt: true },
    });
    return { id: c.id, em: c.createdAt };
  }

  async apagar(userId: string, deckId: string, comentarioId: string) {
    const comentario = await this.prisma.deckComment.findFirst({
      where: { id: comentarioId, deckId },
      select: { userId: true, deck: { select: { userId: true } } },
    });
    if (!comentario) throw new NotFoundException('Comentário não encontrado');
    if (comentario.userId !== userId && comentario.deck.userId !== userId) {
      throw new ForbiddenException('Só o autor ou o dono do deck apagam um comentário.');
    }
    await this.prisma.deckComment.delete({ where: { id: comentarioId } });
  }

  /** Mesma regra do Explorar: público e de dono ativo — ou 404, sem distinguir. */
  private async exigirPublico(deckId: string) {
    const deck = await this.prisma.deck.findFirst({
      where: { id: deckId, isPublic: true, user: { deletedAt: null } },
      select: { id: true, userId: true },
    });
    if (!deck) throw new NotFoundException('Deck não encontrado');
    return deck;
  }
}
