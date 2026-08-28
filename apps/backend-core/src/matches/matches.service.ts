import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { DecksService } from '../decks/decks.service.js';
import { AccessToken } from 'livekit-server-sdk';

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
        deckId, // Passado para o Colyseus provisionar o deck
      },
      { jwtid: jti, expiresIn: '15m' } // 15 minutos para tentar conectar
    );

    return { seatToken, roomCode };
  }

  async getVoiceToken(userId: string, username: string, roomCode: string) {
    const apiKey = process.env.LIVEKIT_API_KEY || 'devkey';
    const apiSecret = process.env.LIVEKIT_API_SECRET || 'secret';

    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: username,
      ttl: '60s', // JWT válido por 60s (Sessão LiveKit dura o tempo da partida)
    });

    at.addGrant({
      room: roomCode,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false, // Dados vão pelo Colyseus
    });

    return { token: await at.toJwt() };
  }
}
