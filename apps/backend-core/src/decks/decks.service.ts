import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { BoardType } from '@prisma/client';

interface ScryCard {
  id: string;
  name: string;
  set: string;
  type_line?: string;
  legalities?: { commander?: string };
  image_uris?: { normal?: string, small?: string };
  card_faces?: Array<{ image_uris?: { normal?: string, small?: string } }>;
  prices?: { usd?: string, eur?: string, tix?: string };
}

interface ScryResponse {
  data?: ScryCard[];
  not_found?: Array<{ name?: string; set?: string }>;
}

@Injectable()
export class DecksService {
  constructor(private prisma: PrismaService) {}

  async createDeck(userId: string, name: string, formatId: string = 'commander') {
    return this.prisma.deck.create({
      data: {
        userId,
        name,
        formatId,
      },
    });
  }

  async getDecks(userId: string) {
    return this.prisma.deck.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getDeckById(userId: string, deckId: string) {
    const deck = await this.prisma.deck.findFirst({
      where: { id: deckId, userId },
      include: { cards: true },
    });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    // Hidratação via Scryfall
    if (deck.cards.length > 0) {
      try {
        const identifiers = deck.cards.map(c => ({ id: c.scryfallId }));
        const scryMap = new Map<string, ScryCard>();
        const chunkSize = 75;
        
        for (let i = 0; i < identifiers.length; i += chunkSize) {
          const chunk = identifiers.slice(i, i + chunkSize);
          const scryRes = await fetch('https://api.scryfall.com/cards/collection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'AetherTable/1.0' },
            body: JSON.stringify({ identifiers: chunk })
          });
          const scryData = await scryRes.json() as ScryResponse;
          
          if (scryData.data) {
            scryData.data.forEach(d => scryMap.set(d.id, d));
          }
          
          if (identifiers.length > chunkSize) await new Promise(r => setTimeout(r, 100)); // Respect rate limits
        }

        // Injeta dados virtuais para o frontend usar (nome, legalidade, set)
        (deck as any).cards = deck.cards.map((c) => {
          const extra = scryMap.get(c.scryfallId);
          return {
            ...c,
            name: extra ? extra.name : 'Desconhecido',
            set: extra ? extra.set.toUpperCase() : '???',
            typeLine: extra ? extra.type_line : '',
            isBanned: extra ? extra.legalities?.commander === 'banned' : false,
            imageNormal: extra?.image_uris?.normal || extra?.card_faces?.[0]?.image_uris?.normal || '',
            priceUsd: extra?.prices?.usd || 0,
          };
        });
      } catch (e) {
        console.error('Falha ao hidratar cartas', e);
      }
    }

    return deck;
  }

  async deleteDeck(userId: string, deckId: string) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    await this.prisma.deck.delete({ where: { id: deckId } });
    return { success: true };
  }

  async updateDeck(userId: string, deckId: string, name: string) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    return this.prisma.deck.update({
      where: { id: deckId },
      data: { name },
    });
  }

  async removeCard(userId: string, deckId: string, cardId: string) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    const card = await this.prisma.deckCard.findUnique({ where: { id: cardId } });
    if (!card || card.deckId !== deckId) throw new NotFoundException('Carta não encontrada');

    await this.prisma.deckCard.delete({ where: { id: cardId } });

    await this.prisma.deck.update({
      where: { id: deckId },
      data: { cardCount: { decrement: card.quantity } }
    });

    return { success: true };
  }

  async updateCardQuantity(userId: string, deckId: string, cardId: string, delta: number) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    const card = await this.prisma.deckCard.findUnique({ where: { id: cardId } });
    if (!card || card.deckId !== deckId) throw new NotFoundException('Carta não encontrada');

    const newQuantity = card.quantity + delta;
    if (newQuantity <= 0) {
      await this.prisma.deckCard.delete({ where: { id: cardId } });
      await this.prisma.deck.update({
        where: { id: deckId },
        data: { cardCount: { decrement: card.quantity } }
      });
    } else {
      await this.prisma.deckCard.update({
        where: { id: cardId },
        data: { quantity: newQuantity }
      });
      await this.prisma.deck.update({
        where: { id: deckId },
        data: { cardCount: { increment: delta } }
      });
    }

    return { success: true };
  }

  async addCard(userId: string, deckId: string, scryfallId: string, quantity: number = 1, boardType: BoardType = BoardType.MAIN) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    // Verifica se a carta já existe no deck
    const existingCard = await this.prisma.deckCard.findFirst({
      where: { deckId, scryfallId, boardType }
    });

    if (existingCard) {
      await this.prisma.deckCard.update({
        where: { id: existingCard.id },
        data: { quantity: existingCard.quantity + quantity }
      });
    } else {
      await this.prisma.deckCard.create({
        data: {
          deckId,
          scryfallId,
          quantity,
          boardType
        }
      });
    }

    await this.prisma.deck.update({
      where: { id: deckId },
      data: { cardCount: { increment: quantity } }
    });

    return { success: true };
  }

  async updatePrinting(userId: string, deckId: string, cardId: string, newScryfallId: string) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    const card = await this.prisma.deckCard.findFirst({ where: { id: cardId, deckId } });
    if (!card) throw new NotFoundException('Carta não encontrada no deck');

    await this.prisma.deckCard.update({
      where: { id: cardId },
      data: { scryfallId: newScryfallId }
    });

    return { success: true };
  }

  async updateBoardType(userId: string, deckId: string, cardId: string, boardType: BoardType) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    const card = await this.prisma.deckCard.findFirst({ where: { id: cardId, deckId } });
    if (!card) throw new NotFoundException('Carta não encontrada no deck');

    await this.prisma.deckCard.update({
      where: { id: cardId },
      data: { boardType }
    });

    return { success: true };
  }

  // --- Sistema de Importação ---
  async importDeckList(userId: string, deckId: string, rawText: string) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const parsedCards: { quantity: number; name: string; set?: string }[] = [];

    const LINE_REGEX = /^\s*(?<qty>\d+)\s*[xX]?\s+(?<name>[^([#*]+?)\s*(?:\((?<set1>[A-Za-z0-9]{2,5})\)\s*(?<cn>\S+)?)?\s*(?:\[(?<set2>[A-Za-z0-9]{2,5})\])?\s*(?:\*F\*)?\s*(?:#.*)?$/;

    for (const line of lines) {
      if (line.startsWith('#') || line.startsWith('//') || line.toUpperCase().startsWith('SIDEBOARD')) continue;

      const match = line.match(LINE_REGEX);
      if (match && match.groups) {
        const qty = parseInt(match.groups['qty'] ?? '1', 10);
        const name = match.groups['name']!.trim();
        const set = match.groups['set1'] ?? match.groups['set2'];
        parsedCards.push({ quantity: qty, name, set });
      } else {
        const fbMatch = line.match(/^(\d+)x?\s+(.+)$/);
        if (fbMatch && fbMatch[1] && fbMatch[2]) {
          parsedCards.push({ quantity: parseInt(fbMatch[1], 10), name: fbMatch[2].trim() });
        } else {
          parsedCards.push({ quantity: 1, name: line.trim() });
        }
      }
    }

    if (parsedCards.length === 0) throw new BadRequestException('Nenhuma carta válida encontrada no texto');

    const identifiers = parsedCards.map(c => {
      const idObj: Record<string, string> = { name: c.name };
      if (c.set) idObj['set'] = c.set.toLowerCase();
      return idObj;
    });

    const chunkSize = 75;
    const resolvedCards: { quantity: number; scryfallId: string; name: string; boardType: BoardType }[] = [];
    const notFound: string[] = [];

    for (let i = 0; i < identifiers.length; i += chunkSize) {
      const chunk = identifiers.slice(i, i + chunkSize);

      try {
        const scryRes = await fetch('https://api.scryfall.com/cards/collection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'AetherTable/1.0' },
          body: JSON.stringify({ identifiers: chunk })
        });

        const scryData = await scryRes.json() as ScryResponse;

        if (scryData.not_found) {
          scryData.not_found.forEach((nf) => notFound.push(nf.name ?? nf.set ?? 'desconhecido'));
        }

        if (scryData.data) {
          scryData.data.forEach((cardData) => {
            const original = parsedCards.find(p => p.name.toLowerCase() === cardData.name.toLowerCase());
            if (original) {
              resolvedCards.push({
                quantity: original.quantity,
                scryfallId: cardData.id,
                name: cardData.name,
                boardType: BoardType.MAIN
              });
            }
          });
        }

        if (identifiers.length > chunkSize) await new Promise(r => setTimeout(r, 150));
      } catch (e) {
        throw new BadRequestException('Falha ao comunicar com a Scryfall');
      }
    }

    if (resolvedCards.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.deckCard.deleteMany({ where: { deckId } });

        let totalCount = 0;
        const insertData = resolvedCards.map(rc => {
          totalCount += rc.quantity;
          return {
            deckId,
            scryfallId: rc.scryfallId,
            quantity: rc.quantity,
            boardType: rc.boardType
          };
        });

        await tx.deckCard.createMany({ data: insertData });

        await tx.deck.update({
          where: { id: deckId },
          data: { cardCount: totalCount }
        });
      });
    }

    return { success: true, imported: resolvedCards.length, notFound };
  }
}
