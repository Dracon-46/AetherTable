import { Injectable, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { DecksService } from '../decks/decks.service.js';
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

  /** Formatos em que entrar sem comandante não faz sentido. */
  private static readonly FORMATOS_COM_COMANDANTE = new Set(['commander', 'brawl']);

  /** Dois cobre a dupla de parceiros; três em diante não é regra de nenhum formato. */
  /**
   * Validade do seat token — quanto tempo o passe da mesa aceita ser usado.
   *
   * Eram 15 minutos, pensados como "tempo para terminar de conectar". Na
   * prática o passe viaja na URL da mesa (`/play/CODE?token=...`), e é essa URL
   * que as pessoas mandam no grupo, deixam aberta numa aba e voltam a abrir
   * depois do jantar. Quinze minutos transformavam qualquer combinação de
   * partida em "entra agora ou o link morre".
   *
   * ATENÇÃO — ISTO NÃO FAZ O PASSE VALER PARA VÁRIAS ENTRADAS.
   *
   * O `AetherRoom` guarda o `jti` de cada passe consumido e recusa o segundo
   * uso (FR-20). Recarregar a página continua queimando o passe; o que muda
   * aqui é só até quando a PRIMEIRA entrada é aceita. São dois limites
   * diferentes, e confundi-los faz parecer que o link simplesmente falha ao
   * acaso.
   *
   * O custo de esticar: uma URL vazada continua valendo por um dia em vez de
   * quinze minutos. O uso único é o que segura esse risco — quem entrar
   * primeiro com o link queima o passe e o segundo é recusado.
   */
  private static readonly SEAT_TOKEN_TTL = '1d';

  private static readonly MAX_COMANDANTES = 2;

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

    /**
     * CONTA AS CARTAS DE VERDADE, NÃO O CONTADOR.
     *
     * `deck.cardCount` é desnormalizado: mantido por `increment`/`decrement` a
     * cada mutação, em statements SEPARADOS da escrita da carta e — fora do
     * import — SEM TRANSAÇÃO. Basta a segunda operação falhar (o Neon do plano
     * gratuito autossuspende, a conexão pooled cai) para a carta entrar e o
     * contador não andar.
     *
     * Validar contra o contador significa recusar mesa por causa de um número
     * errado, com a mensagem "seu grimório possui 97 cartas" enquanto a tela do
     * deckbuilder mostra 100. O jogador não tem como resolver isso: o deck dele
     * está certo.
     *
     * As cartas vêm junto no `getDeckById`, então a soma real custa zero
     * consulta a mais. Reserva e maybeboard ficam de fora — não são o deck.
     */
    const naContagem = new Set(['MAIN', 'COMMANDER', 'SIGNATURE_SPELL']);
    type CartaContavel = { quantity?: number; boardType?: string };
    const total = (deck.cards as CartaContavel[]).reduce(
      // `quantity` é `@default(1)` no schema: uma linha de DeckCard é, no
      // mínimo, uma carta. Assumir 0 na ausência descartaria cartas reais.
      (soma, c) => (naContagem.has(c.boardType ?? 'MAIN') ? soma + (c.quantity ?? 1) : soma),
      0,
    );

    // Contador divergente não bloqueia ninguém, mas precisa aparecer no log:
    // é o sintoma de uma escrita que falhou pela metade.
    if (total !== deck.cardCount) {
      console.warn(
        `[matches] cardCount dessincronizado no deck ${deckId}: contador=${deck.cardCount}, real=${total}`,
      );
    }

    if (regra.exato !== undefined && total !== regra.exato) {
      throw new BadRequestException(
        `O grimório possui ${total} cartas, mas ${formato} exige exatamente ${regra.exato}.`,
      );
    }
    if (regra.exato === undefined && total < regra.min) {
      throw new BadRequestException(
        `O grimório possui ${total} cartas, mas ${formato} exige no mínimo ${regra.min}.`,
      );
    }

    // O `getDeckById` hidrata cada carta com dados da Scryfall — daí `name` e
    // `isBanned`, que não existem no registro cru do Prisma.
    type CartaHidratada = { name?: string; isBanned?: boolean; boardType?: string };

    // 2.1 — Trava de comandante.
    //
    // A contagem de cartas passava, o deck entrava, e o `AetherRoom` provisionava
    // uma zona de comando VAZIA: partida de Commander sem comandante, com
    // imposto e dano de comandante que nunca teriam de onde sair. O sintoma
    // aparecia só na mesa, depois de todo mundo já ter entrado.
    //
    // Barrar aqui e não no game-server é deliberado: este é o ponto onde já
    // conhecemos o formato e o conteúdo do deck, e onde ainda dá para devolver
    // uma mensagem que diz o que fazer. Depois do handshake, o que sobra é
    // derrubar a conexão.
    if (MatchesService.FORMATOS_COM_COMANDANTE.has(formato)) {
      const comandantes = (deck.cards as CartaHidratada[]).filter(
        (c) => c.boardType === 'COMMANDER',
      );
      if (comandantes.length === 0) {
        throw new BadRequestException(
          `O formato ${formato} exige um comandante. Abra o deck e marque a carta como comandante antes de entrar na mesa.`,
        );
      }
      if (comandantes.length > MatchesService.MAX_COMANDANTES) {
        throw new BadRequestException(
          `O deck tem ${comandantes.length} comandantes; o máximo é ${MatchesService.MAX_COMANDANTES} (parceiros).`,
        );
      }
    }

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
      { jwtid: jti, expiresIn: MatchesService.SEAT_TOKEN_TTL },
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
