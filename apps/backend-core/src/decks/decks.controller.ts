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
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DecksService } from './decks.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { InternalApiGuard } from '../common/internal-api.guard.js';
import type { RequisicaoAutenticada } from '../auth/http.types.js';
import type { BoardType } from './board-type.js';

@ApiTags('Decks')
@ApiBearerAuth()
@Controller('decks')
@UseGuards(JwtAuthGuard)
export class DecksController {
  constructor(private readonly decksService: DecksService) {}

  @Post()
  createDeck(
    @Request() req: RequisicaoAutenticada,
    @Body('name') name: string,
    @Body('formatId') formatId?: string,
  ) {
    return this.decksService.createDeck(req.user.sub, name || 'Novo Deck', formatId);
  }

  @Get()
  getDecks(@Request() req: RequisicaoAutenticada) {
    return this.decksService.getDecks(req.user.sub);
  }

  @Get(':id')
  getDeckById(@Request() req: RequisicaoAutenticada, @Param('id') id: string) {
    return this.decksService.getDeckById(req.user.sub, id);
  }

  @Delete(':id')
  deleteDeck(@Request() req: RequisicaoAutenticada, @Param('id') id: string) {
    return this.decksService.deleteDeck(req.user.sub, id);
  }

  @Post(':id/import')
  importDeck(
    @Request() req: RequisicaoAutenticada,
    @Param('id') id: string,
    @Body('decklist') decklist: string,
  ) {
    return this.decksService.importDeckList(req.user.sub, id, decklist);
  }

  @Patch(':id')
  updateDeck(
    @Request() req: RequisicaoAutenticada,
    @Param('id') id: string,
    @Body('name') name: string,
  ) {
    return this.decksService.updateDeck(req.user.sub, id, name);
  }

  @Delete(':id/cards/:cardId')
  removeCard(
    @Request() req: RequisicaoAutenticada,
    @Param('id') id: string,
    @Param('cardId') cardId: string,
  ) {
    return this.decksService.removeCard(req.user.sub, id, cardId);
  }

  @Post(':id/cards')
  addCard(
    @Request() req: RequisicaoAutenticada,
    @Param('id') id: string,
    @Body() body: { scryfallId: string; quantity?: number; boardType?: BoardType },
  ) {
    return this.decksService.addCard(
      req.user.sub,
      id,
      body.scryfallId,
      body.quantity,
      body.boardType,
    );
  }

  @Patch(':id/cards/:cardId/printing')
  updatePrinting(
    @Request() req: RequisicaoAutenticada,
    @Param('id') id: string,
    @Param('cardId') cardId: string,
    @Body() body: { scryfallId: string },
  ) {
    return this.decksService.updatePrinting(req.user.sub, id, cardId, body.scryfallId);
  }

  @Patch(':id/cards/:cardId/quantity')
  updateCardQuantity(
    @Request() req: RequisicaoAutenticada,
    @Param('id') id: string,
    @Param('cardId') cardId: string,
    @Body() body: { delta: number },
  ) {
    return this.decksService.updateCardQuantity(req.user.sub, id, cardId, body.delta);
  }

  @Patch(':id/cards/:cardId/board-type')
  updateBoardType(
    @Request() req: RequisicaoAutenticada,
    @Param('id') id: string,
    @Param('cardId') cardId: string,
    @Body() body: { boardType: BoardType },
  ) {
    return this.decksService.updateBoardType(req.user.sub, id, cardId, body.boardType);
  }
}

/**
 * Rota máquina-a-máquina consumida pelo game-server ao provisionar o deck.
 *
 * Ela NÃO checa dono — o servidor de jogo precisa do deck de qualquer jogador
 * da sala. Justamente por isso precisa de um segredo compartilhado:
 * sem o guard, era um endpoint público que devolvia o decklist completo de
 * qualquer id.
 */
@ApiTags('Internal')
@Controller('internal/decks')
@UseGuards(InternalApiGuard)
export class InternalDecksController {
  constructor(private readonly decksService: DecksService) {}

  @Get(':id')
  @ApiOperation({ summary: 'Deck completo para o game-server (uso interno)' })
  getDeckForServer(@Param('id') id: string) {
    // Antes: `(this.decksService as any).prisma.deck.findUnique(...)` — o
    // controller alcançava um campo privado do serviço por asserção `any`.
    return this.decksService.getDeckForServer(id);
  }
}
