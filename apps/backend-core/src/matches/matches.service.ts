import { Injectable, BadRequestException } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import type { DecksService } from '../decks/decks.service.js';
import { AccessToken } from 'livekit-server-sdk';

@Injectable()
export class MatchesService {
  constructor(
    private jwtService: JwtService,
    private decksService: DecksService,
  ) {}

  /**
   * Tamanho minimo de deck por formato. A validacao anterior exigia
   * EXATAMENTE 100 cartas para qualquer formato: com um deck de Standard ou
   * Modern (60 cartas) o `join` respondia 400 e o jogador nunca entrava na
   * mesa — sem nenhuma pista de que o problema era o formato.
   */
  private static readonly TAMANHO_POR_FORMATO: Record<string, { min: number; exato?: number }> = {
    commander: { min: 100, exato: 100 },
    brawl: { min: 60, exato: 60 },
    standard: { min: 60 },
    modern: { min: 60 },
    pauper: { min: 60 },
    legacy: { min: 60 },
    vintage: { min: 60 },
    timeless: { min: 60 },
  };

  async createMatch(_userId: string, _username: string) {
    // Gera um roomCode de 6 caracteres
    const roomCode = randomBytes(3).toString('hex').toUpperCase();
    return { roomCode };
  }

  async joinMatch(userId: string, username: string, roomCode: string, deckId: string) {
    // 1. Obter o deck e hidratar os dados (o método getDeckById já cuida da validação F05 se tiver banida)
    const deck = await this.decksService.getDeckById(userId, deckId);

    // 2. Trava de Jogo Oficial (F05 adaptado p/ Hard Block no Matchmaking)
    const formato = String(deck.formatId ?? 'commander').toLowerCase();
    const regra = MatchesService.TAMANHO_POR_FORMATO[formato] ?? { min: 60 };

    if (regra.exato !== undefined && deck.cardCount !== regra.exato) {
      throw new BadRequestException(
        `O grimório possui ${deck.cardCount} cartas, mas ${formato} exige exatamente ${regra.exato}.`,
      );
    }
    if (regra.exato === undefined && deck.cardCount < regra.min) {
      throw new BadRequestException(
        `O grimório possui ${deck.cardCount} cartas, mas ${formato} exige no mínimo ${regra.min}.`,
      );
    }

    // O `getDeckById` hidrata cada carta com dados da Scryfall — daí `name` e
    // `isBanned`, que não existem no registro cru do Prisma.
    type CartaHidratada = { name?: string; isBanned?: boolean };
    const bannedCards = (deck.cards as CartaHidratada[]).filter((c) => c.isBanned);
    if (bannedCards.length > 0) {
      const bannedNames = bannedCards.map((c) => c.name ?? 'carta desconhecida').join(', ');
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
      { jwtid: jti, expiresIn: '15m' }, // 15 minutos para tentar conectar
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
