import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * limites-de-conta.ts — quanto uma conta pode guardar.
 *
 * ─── NÃO HAVIA TETO NENHUM ──────────────────────────────────────────────────
 *
 * Criar deck, clonar, copiar do Explorar e usar um deck inicial gravavam sem
 * contar nada, e `addCard` aceitava linhas distintas sem limite. O rate limit
 * por IP segura a VELOCIDADE, não o TOTAL: um script paciente, ou vários IPs,
 * enchia o banco do plano gratuito (o Neon tem teto de armazenamento) com
 * decks de uma conta só — e o banco cheio derruba a plataforma de todo mundo.
 *
 * Os números ficam longe de qualquer uso de verdade: 200 decks é mais do que
 * qualquer coleção pessoal, e 250 linhas cobre com folga um Commander (100) com
 * reserva e "talvez". Um cubo (360 a 540 cartas distintas) não cabe — quando o
 * cubo virar recurso do deckbuilder, este número sobe junto.
 *
 * A contagem e a escrita não são atômicas: duas criações simultâneas no limite
 * podem passar dele por uma ou duas. É aceitável — o teto existe contra o
 * volume, e o `@Throttle` das rotas de criação já impede a rajada.
 */

export const MAXIMO_DE_DECKS_POR_CONTA = 200;

export const MAXIMO_DE_LINHAS_POR_DECK = 250;

/** Recusa a criação de mais um deck quando a conta já está no teto. */
export async function exigirVagaDeDeck(
  prisma: Pick<Prisma.TransactionClient, 'deck'>,
  userId: string,
): Promise<void> {
  const total = await prisma.deck.count({ where: { userId } });
  if (total >= MAXIMO_DE_DECKS_POR_CONTA) {
    throw new BadRequestException(
      `Você já tem ${MAXIMO_DE_DECKS_POR_CONTA} decks, o máximo por conta. Apague algum para criar outro.`,
    );
  }
}
