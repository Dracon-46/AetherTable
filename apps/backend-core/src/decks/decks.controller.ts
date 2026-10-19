import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DecksService } from './decks.service.js';
import { GeradorDeDeckService } from './gerador/gerador-de-deck.service.js';
import { SugestoesDeCartasService } from './gerador/sugestoes.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  AdicionarCartaDto,
  AtualizarBoardTypeDto,
  AtualizarDeckDto,
  AtualizarImpressaoDto,
  AtualizarQuantidadeDto,
  CriarDeckDto,
  ImportarDeckDto,
  TrocarIdiomaDto,
} from './decks.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { InternalApiGuard } from '../common/internal-api.guard.js';
import { SEM_LIMITE_GLOBAL } from '../common/limites.js';
import { validarDeckParaFormato } from './formato.js';
import type { RequisicaoAutenticada } from '../auth/http.types.js';

/**
 * O LIMITE GLOBAL (10 req/5 s) NÃO CABE NO DECKBUILDER.
 *
 * Ele é dimensionado para navegação. A edição de grimório é o oposto: ajustar
 * quantidades, promover comandante e remover cartas são cliques em sequência
 * na MESMA tela. Sob o balde padrão, o sexto clique em cinco segundos voltava
 * 429 — e como o cliente só recarregava o deck em caso de sucesso, a tela
 * simplesmente parava de responder, sem erro visível. A leitura da cadeira do
 * usuário é "o site travou", que foi exatamente o relato.
 *
 * O teto continua existindo, e sobre rota autenticada por JWT: o que ele
 * protege aqui é o banco contra um script, não a tela contra o próprio dono.
 */
const LIMITE_DECK = {
  curto: { limit: 60, ttl: 5_000 },
  longo: { limit: 600, ttl: 60_000 },
};

/**
 * Importação é o oposto: uma chamada resolve até centenas de nomes na Scryfall.
 * Fica com um balde próprio, estreito, para não virar um gerador de tráfego
 * contra o provedor.
 */
const LIMITE_IMPORTACAO = {
  curto: { limit: 3, ttl: 10_000 },
  longo: { limit: 20, ttl: 60_000 },
};

/**
 * Criar e clonar ficavam no balde do deckbuilder (60 a cada 5 s), feito para
 * cliques de quantidade. Cada chamada destas é um deck NOVO no banco: com
 * aquele balde, um script criava centenas por minuto antes de qualquer teto
 * por conta (`limites-de-conta.ts`) entrar em jogo. Ninguém cria cinco decks
 * em dez segundos à mão.
 */
export const LIMITE_CRIACAO_DE_DECK = {
  curto: { limit: 5, ttl: 10_000 },
  longo: { limit: 30, ttl: 60_000 },
};

@ApiTags('Decks')
@ApiBearerAuth()
@Controller('decks')
@UseGuards(JwtAuthGuard)
@Throttle(LIMITE_DECK)
export class DecksController {
  constructor(
    private readonly decksService: DecksService,
    private readonly gerador: GeradorDeDeckService,
    private readonly sugestoes: SugestoesDeCartasService,
  ) {}

  /**
   * DECK ALEATÓRIO: sorteia um comandante e monta o deck em volta dele (ver
   * `gerador/`). Cada pedido são ~11 buscas na Scryfall — o limite é bem mais
   * apertado que o das outras rotas de deck para um clique repetido não
   * esgotar a cota da Scryfall do servidor inteiro.
   */
  @Post('aleatorio')
  @Throttle({ curto: { limit: 2, ttl: 20_000 }, longo: { limit: 15, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Sorteia um comandante e monta um deck de Commander em volta dele' })
  gerarAleatorio(@Request() req: RequisicaoAutenticada) {
    return this.gerador.gerar(req.user.sub);
  }

  @Post()
  @Throttle(LIMITE_CRIACAO_DE_DECK)
  createDeck(
    @Request() req: RequisicaoAutenticada,
    @Body(new ZodValidationPipe(CriarDeckDto)) dto: CriarDeckDto,
  ) {
    return this.decksService.createDeck(req.user.sub, dto.name || 'Novo Deck', dto.formatId);
  }

  @Get()
  getDecks(@Request() req: RequisicaoAutenticada) {
    return this.decksService.getDecks(req.user.sub);
  }

  @Get(':id')
  getDeckById(@Request() req: RequisicaoAutenticada, @Param('id', ParseUUIDPipe) id: string) {
    return this.decksService.getDeckById(req.user.sub, id);
  }

  /**
   * CARTAS RECOMENDADAS para o deck, pelo tema e pela identidade do
   * comandante (ver `gerador/sugestoes.service.ts`). Até cinco buscas na
   * Scryfall por pedido — com cache, mas o limite é apertado pelo mesmo motivo
   * do deck aleatório.
   */
  @Get(':id/sugestoes')
  @Throttle({ curto: { limit: 3, ttl: 10_000 }, longo: { limit: 60, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Cartas recomendadas pelo comandante do deck' })
  sugerirCartas(@Request() req: RequisicaoAutenticada, @Param('id', ParseUUIDPipe) id: string) {
    return this.sugestoes.sugerir(req.user.sub, id);
  }

  /** Uma busca da Scryfall por lote de 12 cartas — o limite é de rota cara. */
  @Post(':id/idioma')
  @Throttle({ curto: { limit: 2, ttl: 30_000 }, longo: { limit: 20, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Troca cada carta do deck pela impressão mais recente num idioma' })
  trocarIdioma(
    @Request() req: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(TrocarIdiomaDto)) dto: TrocarIdiomaDto,
  ) {
    return this.decksService.trocarIdioma(req.user.sub, id, dto.idioma);
  }

  @Delete(':id')
  deleteDeck(@Request() req: RequisicaoAutenticada, @Param('id', ParseUUIDPipe) id: string) {
    return this.decksService.deleteDeck(req.user.sub, id);
  }

  @Post(':id/import')
  @Throttle(LIMITE_IMPORTACAO)
  importDeck(
    @Request() req: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ImportarDeckDto)) dto: ImportarDeckDto,
  ) {
    return this.decksService.importDeckList(req.user.sub, id, dto.decklist);
  }

  @Patch(':id')
  updateDeck(
    @Request() req: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AtualizarDeckDto)) dto: AtualizarDeckDto,
  ) {
    return this.decksService.updateDeck(req.user.sub, id, dto);
  }

  @Post(':id/clone')
  @Throttle(LIMITE_CRIACAO_DE_DECK)
  @ApiOperation({ summary: 'Copia o deck, carta por carta, num deck novo e privado' })
  clonarDeck(@Request() req: RequisicaoAutenticada, @Param('id', ParseUUIDPipe) id: string) {
    return this.decksService.clonarDeck(req.user.sub, id);
  }

  @Delete(':id/cards/:cardId')
  removeCard(
    @Request() req: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
  ) {
    return this.decksService.removeCard(req.user.sub, id, cardId);
  }

  @Post(':id/cards')
  addCard(
    @Request() req: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AdicionarCartaDto)) dto: AdicionarCartaDto,
  ) {
    return this.decksService.addCard(req.user.sub, id, dto.scryfallId, dto.quantity, dto.boardType);
  }

  @Patch(':id/cards/:cardId/printing')
  updatePrinting(
    @Request() req: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body(new ZodValidationPipe(AtualizarImpressaoDto)) dto: AtualizarImpressaoDto,
  ) {
    return this.decksService.updatePrinting(req.user.sub, id, cardId, dto.scryfallId);
  }

  @Patch(':id/cards/:cardId/quantity')
  updateCardQuantity(
    @Request() req: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body(new ZodValidationPipe(AtualizarQuantidadeDto)) dto: AtualizarQuantidadeDto,
  ) {
    return this.decksService.updateCardQuantity(req.user.sub, id, cardId, dto.delta);
  }

  @Patch(':id/cards/:cardId/board-type')
  updateBoardType(
    @Request() req: RequisicaoAutenticada,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cardId', ParseUUIDPipe) cardId: string,
    @Body(new ZodValidationPipe(AtualizarBoardTypeDto)) dto: AtualizarBoardTypeDto,
  ) {
    return this.decksService.updateBoardType(req.user.sub, id, cardId, dto.boardType);
  }
}

/**
 * Rota máquina-a-máquina consumida pelo game-server ao provisionar o deck.
 *
 * Precisa de um segredo compartilhado: sem o guard, era um endpoint público
 * que devolvia o decklist completo de qualquer id. E confere o DONO — ver
 * `ownerId` abaixo.
 */
@ApiTags('Internal')
@Controller('internal/decks')
@UseGuards(InternalApiGuard)
/**
 * FORA DO RATE LIMIT GLOBAL.
 *
 * O balde global é por IP, e todo pedido desta rota vem do MESMO IP — o do nó
 * do game-server. Uma mesa de oito começando junta são oito decks em segundos;
 * duas mesas, dezesseis. Passava de 10 em 5 s, voltava 429, e o jogador via
 * "Seu grimório não pôde ser carregado" com um deck perfeitamente válido. O que
 * protege esta rota é o segredo do `InternalApiGuard` (comparado em tempo
 * constante), não a contagem por IP.
 */
@SkipThrottle(SEM_LIMITE_GLOBAL)
export class InternalDecksController {
  constructor(private readonly decksService: DecksService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Deck completo para o game-server (uso interno)' })
  async getDeckForServer(
    @Param('id', ParseUUIDPipe) id: string,
    /**
     * Quem está pedindo — o `sub` do passe da mesa. OBRIGATÓRIO.
     *
     * Era opcional, e sem ele a rota devolvia o deck de qualquer id, de
     * qualquer dono, pelo caminho que nem hidratava as cartas. O grimório é
     * escolhido na sala de espera por uma intenção do cliente; sem a checagem
     * de dono, qualquer jogador carregava (e lia) o deck de outra pessoa. O
     * game-server passou a mandar o `ownerId` sempre, e a falta dele é 400.
     */
    @Query('ownerId', ParseUUIDPipe) ownerId: string,
    // Formato da SALA. Quando informado, o deck é recusado aqui com a mesma
    // regra que `joinMatch` aplica — e com a mesma mensagem. Sem isso, escolher
    // um deck de 97 cartas na sala de espera dava certo, e a partida só quebrava
    // depois, com todo mundo já sentado.
    @Query('gameType') gameType?: string,
  ) {
    /**
     * `getDeckById` confere o dono (deck de outra conta é o mesmo 404 de deck
     * inexistente — a rota não vira oráculo de ids alheios) e HIDRATA as
     * cartas na Scryfall, que é o que traz `isBanned`. A hidratação é
     * obrigatória: com a Scryfall fora do ar, o deck sairia com toda carta
     * "legal" e a trava de banidas aprovaria qualquer coisa.
     */
    const deck = await this.decksService.getDeckById(ownerId, id, { exigirHidratacao: true });
    validarDeckParaFormato(deck, gameType);
    return deck;
  }
}
