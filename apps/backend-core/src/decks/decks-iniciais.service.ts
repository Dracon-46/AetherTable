/**
 * decks-iniciais.service.ts — decks prontos para quem chega sem deck.
 *
 * Quem cria a conta não tinha com o que jogar: a sala de espera pedia um deck,
 * e montar um de Commander do zero (cem cartas) é a barreira de entrada mais
 * alta do produto (DOC-094 II.9). Os decks iniciais são os pré-montados
 * oficiais, com as listas em `decks-iniciais.dados.ts` (geradas do MTGJSON
 * por `tools/decks-iniciais.mjs`).
 *
 * "Usar" um deck inicial COPIA a lista para a conta: a pessoa joga com ele,
 * edita, troca cartas — é um deck dela, como qualquer outro.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { DECKS_INICIAIS, FONTE_DOS_DECKS_INICIAIS } from './decks-iniciais.dados.js';
import { exigirVagaDeDeck } from './limites-de-conta.js';

/** A descrição que marca o deck como cópia de um inicial — e o reencontra. */
const descricaoDe = (d: (typeof DECKS_INICIAIS)[number]) =>
  `Deck inicial oficial: ${d.nome} (${d.colecao}, ${d.lancamento}). Lista do ${FONTE_DOS_DECKS_INICIAIS}.`;

@Injectable()
export class DecksIniciaisService {
  constructor(private prisma: PrismaService) {}

  /** O catálogo, sem as cem cartas de cada um: a vitrine não precisa delas. */
  listar() {
    return DECKS_INICIAIS.map(({ cartas, ...resto }) => ({
      ...resto,
      totalDeCartas: cartas.reduce((s, c) => s + c.quantity, 0),
    }));
  }

  /**
   * Copia o deck inicial para a conta — ou devolve a cópia que ela já tem.
   *
   * A sala de espera oferece os iniciais no mesmo seletor dos decks da pessoa.
   * Sem o reencontro, cada escolha (e cada "voltei e escolhi de novo") criaria
   * mais um "Calling All Angels" na lista. A cópia é reconhecida pelo nome E
   * pela descrição de origem: um deck que a pessoa renomeou ou reescreveu já
   * é outro deck, e escolher o inicial de novo cria uma cópia limpa.
   */
  async usar(userId: string, codigo: string) {
    const inicial = DECKS_INICIAIS.find((d) => d.codigo === codigo);
    if (!inicial) throw new NotFoundException('Deck inicial não encontrado');

    const descricao = descricaoDe(inicial);
    const existente = await this.prisma.deck.findFirst({
      where: { userId, name: inicial.nome, description: descricao },
    });
    if (existente) return existente;
    // Só quando vai criar: reencontrar a cópia que já existe não ocupa vaga.
    await exigirVagaDeDeck(this.prisma, userId);

    return this.prisma.$transaction(async (tx) => {
      const novo = await tx.deck.create({
        data: {
          userId,
          name: inicial.nome,
          description: descricao,
          formatId: 'commander',
          commanderId: inicial.comandantes[0] ?? null,
          partnerId: inicial.comandantes[1] ?? null,
          colorIdentity: [...inicial.cores],
          cardCount: inicial.cartas.reduce((s, c) => s + c.quantity, 0),
        },
      });
      await tx.deckCard.createMany({
        data: inicial.cartas.map((c) => ({
          deckId: novo.id,
          scryfallId: c.scryfallId,
          quantity: c.quantity,
          boardType: c.boardType,
        })),
      });
      return novo;
    });
  }
}
