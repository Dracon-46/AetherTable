import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { CardsService } from '../cards/cards.service.js';
import { BoardType, type DeckCard } from '@prisma/client';
import type { ScryfallCard } from '@aethertable/scryfall-client';
import { acharFormato } from '@aethertable/shared-types';
import {
  MAXIMO_DE_COPIAS,
  analisarListaDeImportacao,
  casarResultados,
  pedidosAScryfall,
} from './importacao.js';

/** A mensagem do teto, igual em toda rota que escreve quantidade. */
const ACIMA_DO_TETO = `Máximo de ${MAXIMO_DE_COPIAS} cópias por carta`;

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
        //
        // Minúsculas dos dois lados: linhas gravadas antes de o DTO normalizar
        // podem ter o id em maiúsculas, e a Scryfall devolve em minúsculas. Sem
        // isto a carta não casava, vinha sem nome e com `isBanned: false` — uma
        // banida em maiúsculas passava pela trava da mesa.
        const unicos = [...new Set(deck.cards.map((c) => c.scryfallId.toLowerCase()))];
        const resposta = await this.cards.collection(unicos.map((id) => ({ id })));
        const scryMap = new Map<string, ScryfallCard>(
          resposta.data.map((d) => [d.id.toLowerCase(), d]),
        );

        /**
         * A CHAVE DE LEGALIDADE DO FORMATO, e não o id do formato.
         *
         * Era `legalities[deck.formatId]`. Para Commander e Modern os dois
         * coincidem, e por isso o defeito não aparecia; para Duel Commander
         * (`duel`), PDH (`paupercommander`), Historic Brawl (`brawl`) e
         * Commander 1v1 (`commander`) a chave lida não existia, e NENHUMA
         * banida era marcada — o deck entrava na mesa com elas.
         */
        const chave = acharFormato(deck.formatId).deck.chaveDeLegalidade;

        // Injeta dados virtuais para o frontend usar (nome, legalidade, set)
        (deck as { cards: unknown[] }).cards = deck.cards.map((c) => {
          const extra = scryMap.get(c.scryfallId.toLowerCase());
          return {
            ...c,
            name: extra ? extra.name : 'Desconhecido',
            set: extra ? extra.set.toUpperCase() : '???',
            typeLine: extra ? extra.type_line : '',
            // A legalidade era checada SEMPRE contra Commander, mesmo num deck
            // de Modern ou Pauper: cartas legais no formato do deck vinham
            // marcadas como banidas e o `join` bloqueava a entrada na mesa.
            // Formato sem chave (freeform, peasant) não tem banlist a consultar.
            isBanned:
              extra && chave
                ? (extra.legalities as Record<string, string> | undefined)?.[chave] === 'banned'
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
            // `undefined` quando a carta não voltou: a estimativa de bracket
            // conta isso como "sem dados" e não como "não é Game Changer" —
            // sem a distinção, uma Scryfall fora do ar mostrava "Bracket 1".
            gameChanger: typeof extra?.game_changer === 'boolean' ? extra.game_changer : undefined,
          };
        });
        await this.sincronizarResumo(
          deck,
          deck.cards as unknown as Array<{
            scryfallId: string;
            boardType: BoardType;
            colorIdentity?: string[];
          }>,
        );
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

  async updateDeck(
    userId: string,
    deckId: string,
    dados: { name?: string; description?: string; isFavorite?: boolean; isPublic?: boolean },
  ) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    // Só o que veio: um `undefined` mandado ao Prisma é ignorado, mas deixar a
    // lista explícita impede que um campo novo do DTO vire escrita sem querer.
    const { name, description, isFavorite, isPublic } = dados;
    return this.prisma.deck.update({
      where: { id: deckId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(isFavorite !== undefined ? { isFavorite } : {}),
        ...(isPublic !== undefined ? { isPublic } : {}),
      },
    });
  }

  /**
   * ─── CLONAR UM DECK ──────────────────────────────────────────────────────
   *
   * Testar uma variação ("e se eu tirar o pacote de ramp?") exigia exportar,
   * criar um deck novo e importar — e a importação refaz a busca de cada
   * carta. Clonar copia as linhas como estão, impressão por impressão, numa
   * transação só: ou o deck novo nasce inteiro, ou não nasce.
   *
   * O clone nasce PRIVADO e fora dos favoritos: é um rascunho, não uma
   * segunda publicação do original.
   */
  async clonarDeck(userId: string, deckId: string) {
    const original = await this.prisma.deck.findFirst({
      where: { id: deckId, userId },
      include: { cards: true },
    });
    if (!original) throw new NotFoundException('Deck não encontrado');

    const nome = `${original.name} (cópia)`.slice(0, 80);
    return this.prisma.$transaction(async (tx) => {
      const novo = await tx.deck.create({
        data: {
          userId,
          name: nome,
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

  /**
   * ─── COMANDANTE E IDENTIDADE DE COR, GRAVADOS AO ABRIR ───────────────────
   *
   * `commanderId`, `partnerId` e `colorIdentity` existiam na tabela e nunca
   * eram escritos (DOC-094 II.3): a lista de decks não tinha como mostrar o
   * comandante nem as cores sem abrir cada deck. Calcular a cada mutação
   * custaria uma consulta à Scryfall por clique de quantidade; aqui a
   * hidratação JÁ aconteceu, então o resumo sai de graça — e quem edita um
   * deck o abre, então ele nunca fica muito tempo defasado.
   *
   * Só grava quando mudou: `updatedAt` é `@updatedAt`, e regravar o mesmo
   * valor reordenaria a lista de decks a cada visualização.
   */
  private async sincronizarResumo(
    deck: {
      id: string;
      commanderId: string | null;
      partnerId: string | null;
      colorIdentity: string[];
    },
    cartas: Array<{ scryfallId: string; boardType: BoardType; colorIdentity?: string[] }>,
  ): Promise<void> {
    const comandantes = cartas.filter((c) => c.boardType === BoardType.COMMANDER);
    const commanderId = comandantes[0]?.scryfallId.toLowerCase() ?? null;
    const partnerId = comandantes[1]?.scryfallId.toLowerCase() ?? null;
    // Sem comandante (Modern, Pauper…), a identidade é a do deck inteiro.
    const fonte = comandantes.length > 0 ? comandantes : cartas;
    const cores = new Set(fonte.flatMap((c) => c.colorIdentity ?? []));
    const colorIdentity = ['W', 'U', 'B', 'R', 'G'].filter((c) => cores.has(c));

    const igual =
      deck.commanderId === commanderId &&
      deck.partnerId === partnerId &&
      deck.colorIdentity.join('') === colorIdentity.join('');
    if (igual) return;

    try {
      await this.prisma.deck.update({
        where: { id: deck.id },
        data: { commanderId, partnerId, colorIdentity },
      });
    } catch (erro) {
      // Resumo é conveniência da lista: falhar aqui não pode derrubar a
      // abertura do deck.
      this.logger.warn(`Resumo do deck ${deck.id} não foi gravado: ${String(erro)}`);
    }
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
    //
    // O decremento usa a quantidade que o `delete` APAGOU, e não a lida acima:
    // um `+1` de outra aba entre a leitura e a remoção deixava o contador uma
    // cópia acima do deck real.
    await this.prisma.$transaction(async (tx) => {
      const apagada = await tx.deckCard.delete({
        where: { id: cardId },
        select: { quantity: true },
      });
      await tx.deck.update({
        where: { id: deckId },
        data: { cardCount: { decrement: apagada.quantity } },
      });
    });

    return { success: true };
  }

  /**
   * ─── QUANTIDADE RELATIVA, NUNCA ABSOLUTA ─────────────────────────────────
   *
   * Era `quantity: card.quantity + delta`, com `card` lido ANTES da transação.
   * Dois cliques de `+1` concorrentes (duas abas, ou o duplo clique que a tela
   * não segura) liam o mesmo 3 e gravavam os dois 4 — enquanto o contador,
   * que já era relativo, subia para 5. O deck ficava com `cardCount` acima da
   * soma real, e a mesa recusava um deck correto.
   *
   * Agora a quantidade é escrita com `increment`, e a decisão de apagar ou de
   * recusar o teto sai do valor que o PRÓPRIO update devolveu: a linha fica
   * travada até o fim da transação, então o segundo clique enxerga o primeiro.
   * Não havia teto aqui: `+99` sobre 99 gravava 198.
   */
  async updateCardQuantity(userId: string, deckId: string, cardId: string, delta: number) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    const card = await this.prisma.deckCard.findUnique({ where: { id: cardId } });
    if (!card || card.deckId !== deckId) throw new NotFoundException('Carta não encontrada');

    if (delta === 0) return { success: true };

    await this.prisma.$transaction(async (tx) => {
      const linha = await tx.deckCard.update({
        where: { id: cardId },
        data: { quantity: { increment: delta } },
        select: { quantity: true },
      });

      // Lançar dentro da transação desfaz o incremento acima.
      if (linha.quantity > MAXIMO_DE_COPIAS) throw new BadRequestException(ACIMA_DO_TETO);

      if (linha.quantity <= 0) {
        await tx.deckCard.delete({ where: { id: cardId } });
        // Saem do contador as cópias que a linha tinha ANTES deste delta.
        await tx.deck.update({
          where: { id: deckId },
          data: { cardCount: { decrement: linha.quantity - delta } },
        });
        return;
      }

      await tx.deck.update({
        where: { id: deckId },
        data: { cardCount: { increment: delta } },
      });
    });

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

    // O DTO já normaliza; repetir aqui protege qualquer outro chamador. Um id
    // em maiúsculas virava uma segunda linha da mesma carta.
    const id = scryfallId.toLowerCase();

    /**
     * `upsert` na chave única, com `increment`.
     *
     * Era `findFirst` e depois `update` com `existente.quantity + quantity` —
     * leitura e escrita separadas. Dois "adicionar" simultâneos liam o mesmo
     * valor e um dos incrementos sumia (o contador, relativo, contava os dois),
     * ou os dois tentavam `create` e o segundo estourava a chave única em 500.
     */
    await this.prisma.$transaction(async (tx) => {
      const linha = await tx.deckCard.upsert({
        where: { deckId_scryfallId_boardType: { deckId, scryfallId: id, boardType } },
        create: { deckId, scryfallId: id, quantity, boardType },
        update: { quantity: { increment: quantity } },
        select: { quantity: true },
      });

      // O teto do DTO vale por pedido; somado ao que já estava, passava dele.
      if (linha.quantity > MAXIMO_DE_COPIAS) throw new BadRequestException(ACIMA_DO_TETO);

      // Carta e contador na MESMA transação: as duas acontecem, ou nenhuma.
      await tx.deck.update({
        where: { id: deckId },
        data: { cardCount: { increment: quantity } },
      });
    });

    return { success: true };
  }

  async updatePrinting(userId: string, deckId: string, cardId: string, newScryfallId: string) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    const card = await this.prisma.deckCard.findFirst({ where: { id: cardId, deckId } });
    if (!card) throw new NotFoundException('Carta não encontrada no deck');

    await this.moverLinha(deckId, card, {
      scryfallId: newScryfallId.toLowerCase(),
      boardType: card.boardType,
    });

    return { success: true };
  }

  async updateBoardType(userId: string, deckId: string, cardId: string, boardType: BoardType) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    const card = await this.prisma.deckCard.findFirst({ where: { id: cardId, deckId } });
    if (!card) throw new NotFoundException('Carta não encontrada no deck');

    await this.moverLinha(deckId, card, { scryfallId: card.scryfallId, boardType });

    return { success: true };
  }

  /**
   * ─── MOVER PARA ONDE A CARTA JÁ ESTÁ É JUNTAR, NÃO ERRO 500 ──────────────
   *
   * Trocar o board ou a impressão de uma linha é reescrever dois campos da
   * chave única `(deckId, scryfallId, boardType)`. Quando o destino já existe —
   * mover para a reserva uma carta que já tinha cópia lá, trocar para a
   * impressão que o deck já usava — o `update` batia na chave única e a rota
   * respondia 500, sem dizer nada a quem clicou.
   *
   * O que a pessoa quis é óbvio: as cópias vão para lá. As quantidades são
   * somadas na linha que já existia e a de origem some. O `cardCount` não muda,
   * porque o total de cópias é o mesmo.
   */
  private async moverLinha(
    deckId: string,
    card: DeckCard,
    para: { scryfallId: string; boardType: BoardType },
  ): Promise<void> {
    if (card.scryfallId === para.scryfallId && card.boardType === para.boardType) return;

    await this.prisma.$transaction(async (tx) => {
      const destino = await tx.deckCard.findUnique({
        where: { deckId_scryfallId_boardType: { deckId, ...para } },
        select: { id: true },
      });

      if (!destino) {
        await tx.deckCard.update({ where: { id: card.id }, data: para });
        return;
      }

      const origem = await tx.deckCard.delete({
        where: { id: card.id },
        select: { quantity: true },
      });
      const juntas = await tx.deckCard.update({
        where: { id: destino.id },
        data: { quantity: { increment: origem.quantity } },
        select: { quantity: true },
      });
      if (juntas.quantity > MAXIMO_DE_COPIAS) {
        throw new BadRequestException(
          `A carta já está lá, e juntas passariam de ${MAXIMO_DE_COPIAS} cópias.`,
        );
      }
    });
  }

  // --- Sistema de Importação ---
  async importDeckList(userId: string, deckId: string, rawText: string) {
    const deck = await this.prisma.deck.findFirst({ where: { id: deckId, userId } });
    if (!deck) throw new NotFoundException('Deck não encontrado');

    // O parser e o casamento com a Scryfall vivem em `importacao.ts`, onde
    // cada regra tem teste — ver o cabeçalho de lá para os defeitos que eles
    // corrigem (seções ignoradas, linhas repetidas perdidas, marcadores de
    // exportador, quantidade sem teto).
    const { linhas, recusadas } = analisarListaDeImportacao(rawText);

    if (linhas.length === 0) {
      if (recusadas.length === 0) {
        throw new BadRequestException('Nenhuma carta válida encontrada no texto');
      }
      // Tudo recusado por quantidade: a pessoa precisa ver o porquê, e não um
      // "nenhuma carta válida" que contradiz o texto que ela colou.
      return { success: true, imported: 0, notFound: recusadas };
    }

    // Um `collection` só: o fatiamento em lotes de 75, o espaçamento entre
    // chamadas e o backoff de 429 vivem no `ScryfallClient` (DOC-035 §3), não
    // aqui. O laço manual duplicava os dois primeiros e não tinha o terceiro.
    let encontradas: ScryfallCard[];
    try {
      encontradas = (await this.cards.collection(pedidosAScryfall(linhas))).data;
    } catch (erro) {
      // A causa real ia para o vazio: sem log, uma queda da Scryfall e um
      // bug de parsing viravam a mesma mensagem genérica.
      this.logger.error(`Falha ao consultar a Scryfall: ${String(erro)}`);
      throw new BadRequestException('Falha ao comunicar com a Scryfall');
    }

    const resultado = casarResultados(linhas, encontradas);
    const notFound = [...recusadas, ...resultado.recusadas];

    if (resultado.linhasDoDeck.length > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.deckCard.deleteMany({ where: { deckId } });

        // As linhas já chegam unidas por impressão + board: duas linhas iguais
        // no `createMany` batiam na chave única e derrubavam o import com 500.
        await tx.deckCard.createMany({
          data: resultado.linhasDoDeck.map((l) => ({ deckId, ...l })),
        });

        await tx.deck.update({
          where: { id: deckId },
          data: {
            cardCount: resultado.linhasDoDeck.reduce((soma, l) => soma + l.quantity, 0),
          },
        });
      });
    }

    return { success: true, imported: resultado.importadas, notFound };
  }
}
