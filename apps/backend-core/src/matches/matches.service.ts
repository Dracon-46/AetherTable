import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { DecksService } from '../decks/decks.service.js';

@Injectable()
export class MatchesService {
  constructor(
    private jwtService: JwtService,
    private decksService: DecksService
  ) {}

  async createMatch(userId: string, username: string) {
    // Gera um roomCode de 6 caracteres
    const roomCode = randomBytes(3).toString('hex').toUpperCase();
    return { roomCode };
  }

  async joinMatch(userId: string, username: string, roomCode: string, deckId: string) {
    // 1. Obter o deck e hidratar os dados (o método getDeckById já cuida da validação F05 se tiver banida)
    const deck = await this.decksService.getDeckById(userId, deckId);
    
    // 2. Trava de Jogo Oficial (F05 adaptado p/ Hard Block no Matchmaking)
    if (deck.cardCount !== 100) {
      throw new BadRequestException(`O grimório possui ${deck.cardCount} cartas, mas o formato exige exatamente 100.`);
    }

    const bannedCards = deck.cards.filter((c: any) => c.isBanned);
    if (bannedCards.length > 0) {
      const bannedNames = bannedCards.map((c: any) => c.name).join(', ');
      throw new BadRequestException(`Seu grimório possui cartas banidas: ${bannedNames}.`);
    }

    // 3. Gerar o SeatToken JWT para a entrada no Game Server (Colyseus)
    const jti = randomBytes(8).toString('hex');
    const seatToken = this.jwtService.sign(
      {
        sub: userId,
        username,
        roomId: roomCode, // Colyseus vincula o JWT a esta sala
      },
      { jwtid: jti, expiresIn: '15m' } // 15 minutos para tentar conectar
    );

    return { seatToken, roomCode };
  }
}
