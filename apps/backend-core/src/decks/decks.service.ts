import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { CardsService } from '../cards/cards.service.js';
import { BoardType } from '@prisma/client';
import type { CardIdentifier, ScryfallCard } from '@aethertable/scryfall-client';

/**
 * ─── POR QUE ESTE SERVIÇO NÃO FALA MAIS COM A SCRYFALL ─────────────────────
 *
 * `getDeckById` e `importDeckList` chamavam `https://api.scryfall.com` com
 * `fetch` cru, cada um com o próprio laço de lotes e o próprio
 * `setTimeout(100)` "para respeitar o rate limit". Três consequências, e a
 * primeira é a que o jogador sentia:
 *
 *  1. NENHUM CACHE. Abrir um grimório de 100 cartas custava dois round-trips à
 *     Scryfall + 100 ms de espera artificial — ~1 s, TODA vez. E o deckbuilder
 *     recarregava o deck inteiro depois de cada `+1`, `−1` e remoção: um clique
 *     de quantidade custava a viagem completa. Era a lentidão principal da tela.
 *  2. FURAVA A FILA GLOBAL (DOC-035 §3). O `ScryfallClient` serializa as
 *     chamadas com 100 ms entre inícios; quem passa por cima dispara em
 *     paralelo com ela, que é exatamente o que a Scryfall bloqueia.
 *  3. DUAS IMPLEMENTAÇÕES do mesmo lote, com backoff só numa delas.
 *
 * `CardsService.collection` resolve os três: responde carta a carta do LRU,
 * pergunta à Scryfall só o que falta, e o que falta vai pela fila única com
 * backoff. Num deck reaberto, a hidratação passa a custar ZERO requisições.
 */

@Injectable()
export class DecksService {
  private readonly logger = new Logger(DecksService.name);

  constructor(
    private prisma: PrismaService,
    private cards: CardsService,
  ) {}

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

    // Hidratação via Scryfall — pelo espelho cacheado, nunca pela CDN crua.
    if (deck.cards.length > 0) {
      try {
        // Ids REPETIDOS não viram identificadores repetidos: um deck com
        // quatro cópias da mesma impressão pedia a mesma carta quatro vezes e
        // consumia o teto de 75 do lote com duplicatas.
        const unicos = [...new Set(deck.cards.map((c) => c.scryfallId))];
        const resposta = await this.cards.collection(unicos.map((id) => ({ id })));
        const scryMap = new Map<string, ScryfallCard>(resposta.data.map((d) => [d.id, d]));

        // Injeta dados virtuais para o frontend usar (nome, legalidade, set)
        (deck as { cards: unknown[] }).cards = deck.cards.map((c) => {
          const extra = scryMap.get(c.scryfallId);
          return {
            ...c,
            name: extra ? extra.name : 'Desconhecido',
            set: extra ? extra.set.toUpperCase() : '???',
            typeLine: extra ? extra.type_line : '',
            // A legalidade era checada SEMPRE contra Commander, mesmo num deck
            // de Modern ou Pauper: cartas legais no formato do deck vinham
            // marcadas como banidas e o `join` bloqueava a entrada na mesa.
            isBanned: extra
              ? (extra.legalities as Record<string, string> | undefined)?.[
                  String(deck.formatId ?? 'commander').toLowerCase()
                ] === 'banned'
              : false,
            imageNormal:
              extra?.image_uris?.normal || extra?.card_faces?.[0]?.image_uris?.normal || '',
            priceUsd: extra?.prices?.usd || 0,
            /**
             * COR, CUSTO E CMC — já vinham na resposta e eram jogados fora.
             *
             * A tela oferecia "Agrupar por tipo" e nada mais, porque era o
             * único critério derivável de `typeLine`. Agrupar por cor ou por
             * custo é o corte que todo deckbuilder tem, e ele estava
             * bloqueado por três campos que a Scryfall já havia mandado nesta
             * mesma requisição.
             *
             * Carta de dupla face não tem `mana_cost` na raiz: o custo mora
             * nas faces (DOC-035 §2.2). Sem o recuo, toda MDFC apareceria
             * como custo zero.
             */
            colorIdentity: extra?.color_identity ?? [],
            cmc: typeof extra?.cmc === 'number' ? extra.cmc : null,
            manaCost: extra?.mana_cost || extra?.card_faces?.[0]?.mana_cost || '',
            /**
             * RARIDADE E O OBJETO `legalities` INTEIRO.
             *
             * `isBanned` acima é uma leitura de UMA chave, reduzida a um
             * booleano — e essa redução jogava fora as outras duas respostas
             * que a Scryfall dá no mesmo campo:
             *
             *   'restricted' — Vintage limita a UMA cópia. Não é banida, e
             *                  colapsada num booleano ela sumia por completo.
             *   'not_legal'  — a carta não existe no pool do formato, que é
             *                  diferente de ter sido proibida nele.
             *
             * Mandar o objeto cru deixa o validador compartilhado
             * (`avaliarLegalidade`) distinguir os três, e deixa o CLIENTE
             * reavaliar a legalidade contra outro formato sem uma ida ao
             * servidor — é o que faz o painel de legalidade reagir na hora
             * quando o jogador troca o formato do deck.
             */
            rarity: extra?.rarity ?? '',
            legalities: extra?.legalities ?? {},
          };
        });
      } catch (erro) {
        // A hidratação é enriquecimento: se a Scryfall cair, o deck ainda
        // precisa ser devolvido — só sem nome, set e legalidade.
        this.logger.error(`Falha ao hidratar cartas na Scryfall: ${String(erro)}`);
      }
    }

    return deck;
  }

  /**
   * Deck completo SEM checagem de dono — só para o game-server provisionar a
   * partida. A rota que expõe isto é protegida pelo `InternalApiGuard`; até a
   * auditoria de 31/08 ela era pública, e o controller alcançava `this.prisma`
   * por dentro do serviço com um `as any`.
   */
  /**
   * Deck completo para o game-server.
   *
   * `ownerId` e OPCIONAL por compatibilidade com o fluxo antigo (o deck vinha
   * dentro do seat token, ja validado em `MatchesService.joinMatch`), e
   * OBRIGATORIO no fluxo novo: desde que o grimorio passou a ser escolhido
   * dentro da sala de espera, o id chega numa intencao do cliente. Sem a
   * checagem de dono aqui, qualquer jogador podia pedir `INTENT_SET_DECK` com o
   * id do deck de outra pessoa e entrar na mesa jogando com o baralho alheio —
   * lendo, de quebra, a lista inteira dele.
   *
   * Devolve `null` quando o deck nao existe OU nao e de quem pediu: as duas
   * respostas sao iguais de proposito, para o endpoint nao virar um oraculo que
   * confirma a existencia de ids alheios.
   */
  async getDeckForServer(deckId: string, ownerId?: string) {
    const deck = await this.prisma.deck.findUnique({
      where: { id: deckId },
      include: { cards: true },
    });
    if (!deck) return null;
    if (ownerId && deck.userId !== ownerId) return null;
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

    // As duas escritas numa transação só. Separadas, uma falha de conexão
    // entre elas — o Neon do plano gratuito autossuspende — apagava a carta e
    // deixava o contador alto. O deck passava a ser recusado na mesa por um
    // número que não corresponde a nada.
    await this.prisma.$transaction([
      this.prisma.deckCard.delete({ where: { id: cardId } }),
      this.prisma.deck.update({
        where: { id: deckId },
        data: { cardCount: { decrement: card.quantity } },
      }),
    ]);

    return { success: true };
  }

  async updateCardQuantity(userId: string, deckId: string, cardId: string, delta: number) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    const card = await this.prisma.deckCard.findUnique({ where: { id: cardId } });
    if (!card || card.deckId !== deckId) throw new NotFoundException('Carta não encontrada');

    const newQuantity = card.quantity + delta;
    if (newQuantity <= 0) {
      await this.prisma.$transaction([
        this.prisma.deckCard.delete({ where: { id: cardId } }),
        this.prisma.deck.update({
          where: { id: deckId },
          data: { cardCount: { decrement: card.quantity } },
        }),
      ]);
    } else {
      await this.prisma.$transaction([
        this.prisma.deckCard.update({ where: { id: cardId }, data: { quantity: newQuantity } }),
        this.prisma.deck.update({
          where: { id: deckId },
          data: { cardCount: { increment: delta } },
        }),
      ]);
    }

    return { success: true };
  }

  async addCard(
    userId: string,
    deckId: string,
    scryfallId: string,
    quantity: number = 1,
    boardType: BoardType = BoardType.MAIN,
  ) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    // Verifica se a carta já existe no deck
    const existingCard = await this.prisma.deckCard.findFirst({
      where: { deckId, scryfallId, boardType },
    });

    const escritaDaCarta = existingCard
      ? this.prisma.deckCard.update({
          where: { id: existingCard.id },
          data: { quantity: existingCard.quantity + quantity },
        })
      : this.prisma.deckCard.create({ data: { deckId, scryfallId, quantity, boardType } });

    // Carta e contador na MESMA transação: as duas acontecem, ou nenhuma.
    await this.prisma.$transaction([
      escritaDaCarta,
      this.prisma.deck.update({
        where: { id: deckId },
        data: { cardCount: { increment: quantity } },
      }),
    ]);

    return { success: true };
  }

  async updatePrinting(userId: string, deckId: string, cardId: string, newScryfallId: string) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    const card = await this.prisma.deckCard.findFirst({ where: { id: cardId, deckId } });
    if (!card) throw new NotFoundException('Carta não encontrada no deck');

    await this.prisma.deckCard.update({
      where: { id: cardId },
      data: { scryfallId: newScryfallId },
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
      data: { boardType },
    });

    return { success: true };
  }

  // --- Sistema de Importação ---
  async importDeckList(userId: string, deckId: string, rawText: string) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    const lines = rawText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const parsedCards: { quantity: number; name: string; set?: string }[] = [];

    const LINE_REGEX =
      /^\s*(?<qty>\d+)\s*[xX]?\s+(?<name>[^([#*]+?)\s*(?:\((?<set1>[A-Za-z0-9]{2,5})\)\s*(?<cn>\S+)?)?\s*(?:\[(?<set2>[A-Za-z0-9]{2,5})\])?\s*(?:\*F\*)?\s*(?:#.*)?$/;

    for (const line of lines) {
      if (
        line.startsWith('#') ||
        line.startsWith('//') ||
        line.toUpperCase().startsWith('SIDEBOARD')
      )
        continue;

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

    if (parsedCards.length === 0)
      throw new BadRequestException('Nenhuma carta válida encontrada no texto');

    const identifiers: CardIdentifier[] = parsedCards.map((c) => {
      const idObj: CardIdentifier = { name: c.name };
      if (c.set) idObj.set = c.set.toLowerCase();
      return idObj;
    });

    const resolvedCards: {
      quantity: number;
      scryfallId: string;
      name: string;
      boardType: BoardType;
    }[] = [];
    const notFound: string[] = [];

    // Um `collection` só: o fatiamento em lotes de 75, o espaçamento entre
    // chamadas e o backoff de 429 vivem no `ScryfallClient` (DOC-035 §3), não
    // aqui. O laço manual duplicava os dois primeiros e não tinha o terceiro.
    {
      try {
        const scryData = await this.cards.collection(identifiers);

        scryData.not_found.forEach((nf) => notFound.push(nf.name ?? nf.set ?? 'desconhecido'));

        {
          scryData.data.forEach((cardData) => {
            /**
             * CASAMENTO DE NOME — o buraco silencioso do import.
             *
             * A comparação era só `p.name === cardData.name`. Só que a Scryfall
             * devolve o nome CANÔNICO, e para carta de dupla face isso é
             * "Delver of Secrets // Insectile Aberration" — enquanto o jogador
             * digitou apenas a face da frente, como está impresso na carta e
             * como todo exportador de deck escreve.
             *
             * Sem casar, a carta caía num `if (original)` que simplesmente não
             * executava: ela não entrava no deck E não entrava em `notFound`.
             * O import respondia "sucesso", o deck ficava com 97 cartas de 100,
             * e o jogador só descobria ao ser barrado na criação da mesa — com
             * uma mensagem que não menciona o import em lugar nenhum.
             */
            const alvo = cardData.name.toLowerCase();
            const frente = alvo.split(' // ')[0]!;

            const original =
              parsedCards.find((p) => p.name.toLowerCase() === alvo) ??
              parsedCards.find((p) => p.name.toLowerCase() === frente) ??
              // Último recurso: o jogador escreveu as duas faces com separador
              // diferente ("Delver of Secrets / Insectile Aberration").
              parsedCards.find((p) => p.name.toLowerCase().split(/\s*\/+\s*/)[0] === frente);

            if (original) {
              resolvedCards.push({
                quantity: original.quantity,
                scryfallId: cardData.id,
                name: cardData.name,
                boardType: BoardType.MAIN,
              });
            } else {
              // Nunca mais em silêncio: se a Scryfall achou e nós não casamos,
              // isso é defeito NOSSO e precisa aparecer para quem importou.
              notFound.push(cardData.name);
            }
          });
        }
      } catch (erro) {
        // A causa real ia para o vazio: sem log, uma queda da Scryfall e um
        // bug de parsing viravam a mesma mensagem genérica.
        this.logger.error(`Falha ao consultar a Scryfall: ${String(erro)}`);
        throw new BadRequestException('Falha ao comunicar com a Scryfall');
      }
    }

    if (resolvedCards.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.deckCard.deleteMany({ where: { deckId } });

        let totalCount = 0;
        const insertData = resolvedCards.map((rc) => {
          totalCount += rc.quantity;
          return {
            deckId,
            scryfallId: rc.scryfallId,
            quantity: rc.quantity,
            boardType: rc.boardType,
          };
        });

        await tx.deckCard.createMany({ data: insertData });

        await tx.deck.update({
          where: { id: deckId },
          data: { cardCount: totalCount },
        });
      });
    }

    return { success: true, imported: resolvedCards.length, notFound };
  }
}
