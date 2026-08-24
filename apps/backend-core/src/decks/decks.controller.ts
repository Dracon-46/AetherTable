import { Controller, Get, Post, Delete, Patch, Body, Param, UseGuards, Request } from '@nestjs/common';
import { DecksService } from './decks.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('decks')
@UseGuards(JwtAuthGuard) // Protege todas as rotas de decks
export class DecksController {
  constructor(private readonly decksService: DecksService) {}

  @Post()
  createDeck(@Request() req: any, @Body('name') name: string) {
    return this.decksService.createDeck(req.user.id, name || 'Novo Deck');
  }

  @Get()
  getDecks(@Request() req: any) {
    return this.decksService.getDecks(req.user.id);
  }

  @Get(':id')
  getDeckById(@Request() req: any, @Param('id') id: string) {
    return this.decksService.getDeckById(req.user.id, id);
  }

  @Delete(':id')
  deleteDeck(@Request() req: any, @Param('id') id: string) {
    return this.decksService.deleteDeck(req.user.id, id);
  }

  @Post(':id/import')
  importDeck(@Request() req: any, @Param('id') id: string, @Body('decklist') decklist: string) {
    return this.decksService.importDeckList(req.user.id, id, decklist);
  }

  @Patch(':id')
  updateDeck(@Request() req: any, @Param('id') id: string, @Body('name') name: string) {
    return this.decksService.updateDeck(req.user.id, id, name);
  }

  @Delete(':id/cards/:cardId')
  removeCard(@Request() req: any, @Param('id') id: string, @Param('cardId') cardId: string) {
    return this.decksService.removeCard(req.user.id, id, cardId);
  }
}

// Rota interna sem Autenticação (apenas para acesso máquina a máquina pelo Colyseus)
@Controller('internal/decks')
export class InternalDecksController {
  constructor(private readonly decksService: DecksService) {}

  @Get(':id')
  async getDeckForServer(@Param('id') id: string) {
    // Usamos o Prisma diretamente aqui para pular a verificação de dono do deck,
    // pois o Game Server precisa das cartas pra qualquer jogador.
    const deck = await (this.decksService as any).prisma.deck.findUnique({
      where: { id },
      include: { cards: true }
    });
    return deck;
  }
}
