import { ForbiddenException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { randomBytes } from 'crypto';
import { DecksService } from '../decks/decks.service.js';
import { validarDeckParaFormato, type DeckValidavel } from '../decks/formato.js';
import { AdminSistemaService, FLAGS } from '../admin/admin-sistema.service.js';
import { AccessToken } from 'livekit-server-sdk';
import { normalizarConfigDeSala, type ConfigDeSala } from '@aethertable/shared-types';
import type { CriarPartidaDto, ResumoDePartidaDto } from './matches.dto.js';

@Injectable()
export class MatchesService {
  constructor(
    private jwtService: JwtService,
    // O resumo pos-partida e a primeira coisa deste servico que escreve no
    // banco: tudo o mais aqui e emissao de token.
    private readonly prisma: PrismaService,
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

  /**
   * Validade do passe de CONFIGURAÇÃO.
   *
   * Curta de propósito, e por um motivo diferente do seat token: este passe
   * nunca viaja numa URL nem é compartilhado no grupo. Ele existe só para
   * atravessar o intervalo entre `POST /create` e `POST /join`, que acontece
   * dentro do mesmo clique. Quinze minutos já são folga generosa para uma
   * requisição que segue imediatamente a outra.
   */
  private static readonly CONFIG_TOKEN_TTL = '15m';

  async createMatch(_userId: string, _username: string, dto: CriarPartidaDto = {}) {
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

    // A MESMA função que o formulário do navegador chamou antes de enviar e que
    // o `onCreate` chamará ao gravar no estado. Ela é idempotente por contrato,
    // então renormalizar o que já veio normalizado não muda nada — e é isso que
    // permite chamá-la nas três pontas sem que elas divirjam.
    const config = normalizarConfigDeSala(dto);

    return { roomCode, config, configToken: this.assinarConfig(roomCode, config) };
  }

  /**
   * ─── A CONFIGURAÇÃO DA SALA VINHA DO NAVEGADOR, E ISSO ERA UM BURACO ──────
   *
   * `client.joinOrCreate(AETHER_ROOM, { roomCode, seatToken, maxClients,
   * gameType })`: as opções da sala eram escritas pelo cliente e NÃO eram
   * assinadas. O `onCreate` só as limitava contra `REALTIME_LIMITS.MAX_PLAYERS`,
   * então nada impedia um navegador de abrir uma mesa de Duel Commander com
   * oito assentos — bastava editar um número na querystring.
   *
   * ─── POR QUE UM PASSE PRÓPRIO, E NÃO A CONFIG DIRETO NO SEAT TOKEN ────────
   *
   * O seat token nasce em `joinMatch`, não aqui. Para ele já sair com a
   * configuração dentro, `joinMatch` precisaria conhecê-la — e não há onde
   * consultar: não existe modelo `Match` persistido, e não vai existir
   * (ADR-006, RN12 — o estado da sala vive na RAM do game node; o que o
   * Postgres guarda é o `MatchSummary`, que é registro pós-partida).
   *
   * As duas saídas eram criar uma tabela para dados que morrem em minutos, ou
   * devolver a configuração ao cliente ASSINADA e pedi-la de volta no join. A
   * segunda mantém o serviço sem estado e resolve o mesmo problema: o navegador
   * continua carregando a configuração de uma requisição para a outra, mas não
   * consegue mais REESCREVÊ-LA no caminho — a assinatura quebra, e o
   * game-server volta a confiar só no que ele mesmo normalizou.
   *
   * O vínculo com o `roomCode` é o que fecha o outro abuso: sem ele, um passe
   * legítimo de uma mesa de oito assentos serviria para entrar em QUALQUER
   * outra sala e ampliá-la.
   */
  private assinarConfig(roomCode: string, cfg: ConfigDeSala): string {
    return this.jwtService.sign(
      { roomId: roomCode, cfg },
      { expiresIn: MatchesService.CONFIG_TOKEN_TTL },
    );
  }

  /**
   * Devolve a configuração assinada, ou `undefined`.
   *
   * `undefined` NÃO é erro. Quem entra pelo código nunca teve passe de
   * configuração — é o caso mais comum desta rota — e recusar a entrada por
   * causa disso trancaria fora da mesa exatamente quem foi convidado.
   *
   * Um passe inválido, expirado ou de outra sala também não derruba a entrada:
   * ele é ignorado, e a sala nasce com o que o `onCreate` normalizou por conta
   * própria. O pior caso é perder o reforço, nunca perder o assento.
   */
  private lerConfigAssinada(roomCode: string, configToken?: string): ConfigDeSala | undefined {
    if (!configToken) return undefined;
    try {
      const claims = this.jwtService.verify<{ roomId?: string; cfg?: Partial<ConfigDeSala> }>(
        configToken,
      );
      if (claims.roomId !== roomCode || !claims.cfg) return undefined;
      // Renormaliza mesmo vindo assinado: o catálogo de formatos pode ter mudado
      // entre a emissão e o uso, e um passe de quinze minutos atrás não é motivo
      // para gravar no estado uma faixa de jogadores que não existe mais.
      return normalizarConfigDeSala(claims.cfg);
    } catch {
      return undefined;
    }
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
  async joinMatch(
    userId: string,
    username: string,
    roomCode: string,
    deckId?: string,
    configToken?: string,
  ) {
    if (deckId) {
      // `getDeckById` hidrata cada carta com dados da Scryfall — daí `name` e
      // `isBanned`, que não existem no registro cru do Prisma.
      const deck = await this.decksService.getDeckById(userId, deckId);
      validarDeckParaFormato(deck as DeckValidavel);
    }

    /**
     * A configuração autorizada viaja DENTRO do passe de assento.
     *
     * O `onCreate` do Colyseus não recebe o resultado do `onAuth` — ele roda
     * antes, com as `options` cruas do cliente, e não há como mudar essa ordem.
     * Quem aplica esta claim é o `onAuth` do PRIMEIRO cliente, que é sempre o
     * criador: com a sala ainda vazia, a configuração assinada sobrescreve a
     * que o navegador mandou.
     */
    const cfg = this.lerConfigAssinada(roomCode, configToken);

    // Gerar o SeatToken JWT para a entrada no Game Server (Colyseus)
    const jti = randomBytes(8).toString('hex');
    const seatToken = this.jwtService.sign(
      {
        sub: userId,
        username,
        roomId: roomCode, // Colyseus vincula o JWT a esta sala
        // Ausente quando o grimório será escolhido na sala de espera.
        ...(deckId ? { deckId } : {}),
        // Ausente para quem entra pelo código: a config dessa sala já está no
        // `RoomState`, e é de lá que o lobby dele a lê.
        ...(cfg ? { cfg } : {}),
      },
      { jwtid: jti, expiresIn: MatchesService.SEAT_TOKEN_TTL },
    );

    return { seatToken, roomCode, config: cfg ?? null };
  }

  /**
   * ─── O RESUMO QUE NUNCA ERA GRAVADO ──────────────────────────────────────
   *
   * `prisma.matchSummary.create` não existia em lugar nenhum do repositório —
   * só `.count()`. As tabelas `match_summaries` e `match_participants` nunca
   * receberam uma linha, e o efeito era "Partidas Jogadas: 0" em todo perfil,
   * em todo perfil público e na métrica do backoffice. Nenhuma estatística de
   * jogador era possível.
   *
   * Quem chama é o game-server, no `onDispose` da sala: é o único momento em
   * que alguém sabe que a partida acabou e quanto ela durou.
   *
   * ─── IDEMPOTENTE POR `roomCode` + JANELA ─────────────────────────────────
   *
   * O `onDispose` pode rodar mais de uma vez para a mesma sala num deploy com
   * mais de um nó, ou numa reconexão do matchmaker. Gravar duas linhas
   * inflaria a contagem de partidas de todo mundo que estava na mesa — e uma
   * estatística inflada é pior que uma zerada, porque parece certa.
   *
   * A janela existe porque `roomCode` NÃO é único: são seis hexadecimais
   * sorteados, sem registro no banco, e o mesmo código pode voltar meses
   * depois. Duas partidas com o mesmo código no mesmo minuto são a mesma
   * partida gravada duas vezes; no mês seguinte, são duas partidas.
   */
  async registrarResumo(dto: ResumoDePartidaDto) {
    const agora = new Date();
    const umMinutoAtras = new Date(agora.getTime() - 60_000);

    const jaExiste = await this.prisma.matchSummary.findFirst({
      where: { roomCode: dto.roomCode, endedAt: { gte: umMinutoAtras } },
      select: { id: true },
    });
    if (jaExiste) return { id: jaExiste.id, duplicado: true };

    const resumo = await this.prisma.matchSummary.create({
      data: {
        roomCode: dto.roomCode,
        playerCount: dto.playerCount,
        durationSeconds: dto.durationSeconds,
        endedAt: agora,
        participants: {
          /**
           * `createMany` com `skipDuplicates` por causa do `@@unique([matchId,
           * userId])`: a mesma conta pode aparecer duas vezes na lista se
           * alguém caiu e reconectou com sessionId novo. Duas linhas iguais
           * fariam a partida contar em dobro para essa pessoa.
           */
          createMany: {
            data: dto.participantes.map((userId) => ({ userId })),
            skipDuplicates: true,
          },
        },
      },
      select: { id: true },
    });

    return { id: resumo.id, duplicado: false };
  }

  /**
   * Passe de ESPECTADOR.
   *
   * ─── POR QUE UMA ROTA PROPRIA, E NAO UMA FLAG NO `joinMatch` ─────────────
   *
   * Porque a diferença entre assistir e jogar decide quem ocupa o último
   * assento de uma mesa cheia, e essa decisão não pode ser um booleano que o
   * cliente manda no corpo. Com uma flag, bastaria enviá-la como `false` para
   * um espectador virar jogador; com rotas separadas, o que autoriza cada caso
   * é a claim assinada — e o game-server só olha o token.
   *
   * ─── ELE NÃO VALIDA DECK, E ISSO É O PONTO ──────────────────────────────
   *
   * `joinMatch` gasta uma ida à Scryfall para hidratar o decklist e conferir
   * banimentos. Quem vai assistir não tem deck para validar, e cobrar essa
   * viagem dele seria pagar o custo mais caro da rota para não usar o
   * resultado. É por isso que assistir é mais barato que entrar, e não só mais
   * permissivo.
   *
   * O que ele NÃO faz é conferir se a sala existe: essa resposta mora no
   * game-server, e o passe já é inútil sem ela — `onAuth` recusa um token cujo
   * `roomId` não bate com a sala. Consultar aqui seria uma chamada entre
   * serviços para antecipar um "não" que chega de qualquer forma.
   */
  async spectateMatch(userId: string, username: string, roomCode: string) {
    const jti = randomBytes(8).toString('hex');
    const seatToken = this.jwtService.sign(
      {
        sub: userId,
        username,
        roomId: roomCode,
        // Sem `deckId` e sem `cfg`: quem assiste não traz baralho nem
        // configura mesa nenhuma.
        spectator: true,
      },
      { jwtid: jti, expiresIn: MatchesService.SEAT_TOKEN_TTL },
    );

    return { seatToken, roomCode, spectator: true as const };
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
