import { ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { DecksService } from '../decks/decks.service.js';
import { validarDeckParaFormato, type DeckValidavel } from '../decks/formato.js';
import { AdminSistemaService, FLAGS } from '../admin/admin-sistema.service.js';
import { AccessToken } from 'livekit-server-sdk';

@Injectable()
export class MatchesService {
  constructor(
    private jwtService: JwtService,
    private decksService: DecksService,
    private sistema: AdminSistemaService,
  ) {}

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

  async createMatch(_userId: string, _username: string) {
    /**
     * O INTERRUPTOR DE MESAS (DOC-061 §5).
     *
     * Serve à manutenção: derrubar o game-server sem fechar a criação de mesas
     * faz cada jogador descobrir a manutenção como uma conexão que falha, na
     * hora em que ele já convidou os amigos. Com o interruptor, a recusa
     * acontece antes, com o motivo escrito.
     *
     * Note que ele NÃO derruba partida em andamento: quem já está na mesa
     * continua jogando, porque o estado vive no game node e este interruptor
     * só fecha a porta de entrada.
     */
    if (!(await this.sistema.flagLigada(FLAGS.MESAS))) {
      throw new ForbiddenException(
        'A criação de novas mesas está pausada para manutenção. As partidas em andamento seguem normalmente.',
      );
    }

    // Gera um roomCode de 6 caracteres
    const roomCode = randomBytes(3).toString('hex').toUpperCase();
    return { roomCode };
  }

  /**
   * Emite o passe de assento.
   *
   * `deckId` é OPCIONAL desde que a escolha do grimório passou para dentro da
   * sala de espera. Quem já sabe com que deck vai jogar continua validando aqui
   * — é onde a mensagem de erro ainda dá para ser útil, antes de qualquer
   * conexão. Quem não escolheu entra com um passe sem deck e resolve isso no
   * lobby, onde a mesma validação roda pela rota interna (ver
   * `decks/formato.ts`).
   */
  async joinMatch(userId: string, username: string, roomCode: string, deckId?: string) {
    if (deckId) {
      // `getDeckById` hidrata cada carta com dados da Scryfall — daí `name` e
      // `isBanned`, que não existem no registro cru do Prisma.
      const deck = await this.decksService.getDeckById(userId, deckId);
      validarDeckParaFormato(deck as DeckValidavel);
    }

    // Gerar o SeatToken JWT para a entrada no Game Server (Colyseus)
    const jti = randomBytes(8).toString('hex');
    const seatToken = this.jwtService.sign(
      {
        sub: userId,
        username,
        roomId: roomCode, // Colyseus vincula o JWT a esta sala
        // Ausente quando o grimório será escolhido na sala de espera.
        ...(deckId ? { deckId } : {}),
      },
      { jwtid: jti, expiresIn: MatchesService.SEAT_TOKEN_TTL },
    );

    return { seatToken, roomCode };
  }

  /**
   * Passe de voz do LiveKit.
   *
   * ─── O KILL SWITCH DE VOZ MORA AQUI (DOC-061 §5) ─────────────────────────
   *
   * O documento pede "um botao de emergencia que desabilita a flag do LiveKit
   * para todo mundo, caso o faturamento do SFU atinja um teto alarmante ou haja
   * um ataque". Este e o unico ponto por onde um cliente obtem credencial de
   * voz — negar aqui desliga a voz da plataforma inteira sem redeploy.
   *
   * A resposta e `null` em vez de um erro: o cliente ja trata token ausente
   * como "esta mesa nao tem voz" e monta a partida sem o LiveKit. Um 403 faria
   * a tela mostrar falha de conexao numa mesa que esta perfeitamente jogavel.
   */
  async getVoiceToken(userId: string, username: string, roomCode: string) {
    if (!(await this.sistema.flagLigada(FLAGS.VOZ))) {
      return { token: null, motivo: 'A voz esta temporariamente desativada na plataforma.' };
    }

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
