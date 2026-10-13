import { randomUUID } from 'node:crypto';
import type { Client } from '@colyseus/core';
import { Room } from '@colyseus/core';
import jwt from 'jsonwebtoken';
import {
  REALTIME_LIMITS,
  ZONES,
  acharFormato,
  normalizarConfigDeSala,
  zoneOrderKey,
  type ConfigDeSala,
  type JoinOptions,
  type LogEvent,
  type Zone,
} from '@aethertable/shared-types';

import { config } from '../config';
import { Card } from '../schema/Card';
import { Espectador } from '../schema/Espectador';
import { Player } from '../schema/Player';
import { RoomState } from '../schema/RoomState';
import { ZoneOrderList } from '../schema/ZoneOrderList';
// Valor, nao so tipo: `OpcoesDeCriacao` valida as opcoes cruas do navegador.
import { z } from 'zod';
import {
  RateLimiter,
  REGISTRY,
  aplicarTopoRevelado,
  espectadorBarrado,
  haAssentoLivre,
  verificarAutorizacao,
  verificarFimDePartida,
  vidaInicialDaMesa,
  type IntentContext,
  type IntentHandler,
} from '../intents/registry';
import { embaralhar } from '../services/rng';
import { ComandoDeIntencao, HistoricoDeComandos } from '../intents/comandos';
import { logSistema } from '../services/log';
import { reconciliarClient, reconciliarTudo } from '../services/view-sync';
import {
  conexoesAtivas,
  intentsRecebidas,
  intentsRejeitadas,
  reconexoes,
  salasAtivas,
} from '../metrics';

/** Aceita a forma canonica de uuid v1-v5; e o formato do id no Postgres. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Intencoes sujeitas ao teto de sorteio. Sao exatamente as que produzem um
 * `broadcast` a partir de um numero ao acaso.
 */
const INTENCOES_DE_SORTEIO = new Set<string>([
  'INTENT_ROLL_DICE',
  'INTENT_FLIP_COIN',
  'INTENT_RANDOM_PLAYER',
  'INTENT_RANDOM_CARD',
]);

/** Uma carta do deck, como vem de `GET /api/v1/internal/decks/:id`. */
interface DeckCardPayload {
  scryfallId: string;
  quantity: number;
  boardType: string;
}

/** Resposta de `GET /api/v1/internal/decks/:id`. */
interface DeckPayload {
  id: string;
  name: string;
  cards: DeckCardPayload[];
}

/** Conteudo do seat token emitido pela API Core. */
interface SeatTokenClaims {
  sub: string;
  username: string;
  roomId: string;
  jti: string;
  /**
   * OPCIONAL desde que o grimorio passou a ser escolhido na sala de espera.
   *
   * O fluxo antigo embutia o deck no passe: era preciso decidir com que baralho
   * jogar antes de ver quem sentou na mesa, e trocar de ideia significava sair,
   * pedir um passe novo e voltar — so que o passe e de uso unico (FR-20) e o
   * assento antigo ainda estava ocupado. Quem entra sem deck escolhe por
   * `INTENT_SET_DECK`, dentro da sala.
   */
  deckId?: string;
  /**
   * Configuracao da sala, ASSINADA pela API Core (ver `assinarConfig` em
   * `matches.service.ts`).
   *
   * So o criador tem esta claim. Ela existe porque `onCreate` recebe as opcoes
   * CRUAS do navegador — nada ali impedia uma mesa de Duel Commander com oito
   * assentos — e o Colyseus nao entrega o resultado do `onAuth` ao `onCreate`,
   * que roda antes. Aplicar aqui, com a sala ainda vazia, e o unico ponto em
   * que a configuracao autorizada consegue substituir a forjada.
   */
  cfg?: ConfigDeSala;
  /**
   * `true` = passe de ESPECTADOR, emitido por `POST /matches/:code/spectate`.
   *
   * Vem no token assinado, e nao numa opcao do `joinOrCreate`, porque a
   * diferenca entre assistir e jogar decide quem ocupa assento numa mesa cheia.
   * Se fosse um parametro do cliente, bastaria remove-lo da querystring para um
   * espectador virar jogador e tomar o ultimo lugar.
   */
  spectator?: boolean;
}

/**
 * Opcoes cruas do `joinOrCreate`. Sao escritas pelo NAVEGADOR e nao sao
 * assinadas: tudo aqui e uma sugestao ate `normalizarConfigDeSala` passar.
 */
const OpcoesDeCriacao = z
  .object({
    roomCode: z.string().max(64).optional(),
    nome: z.string().max(200).optional(),
    gameType: z.string().max(64).optional(),
    visibilidade: z.string().max(16).optional(),
    comunicacao: z.string().max(16).optional(),
    idioma: z.string().max(16).optional(),
    // `coerce`: a querystring entrega numero como string, e um `maxClients`
    // que chega '4' cairia no padrao do formato em silencio.
    maxClients: z.coerce.number().int().optional(),
    nivelDePoder: z.coerce.number().int().optional(),
  })
  // `catchall` descartado de proposito: `passthrough` deixaria campo
  // desconhecido do cliente chegar ate `normalizarConfigDeSala`, que o
  // ignoraria — mas o proximo a ler o codigo nao teria como saber disso.
  .strip();

export class AetherRoom extends Room<RoomState> {
  override maxClients: number = REALTIME_LIMITS.MAX_PLAYERS;

  private readonly rateLimiter = new RateLimiter();
  /**
   * Teto separado para SORTEIOS (dado, moeda, sorteio de jogador/carta).
   *
   * O limite geral de 30 intencoes/s nao cobria o caso: cada rolagem e uma
   * intencao perfeitamente valida, e segurar o botao do dado produzia 30
   * rolagens por segundo — cada uma com um `broadcast` para a mesa inteira e
   * uma entrada de log em todos os clientes. E a unica familia de acoes em que
   * uma pessoa sozinha gera trabalho para todas as outras sem mudar estado
   * nenhum, e por isso ela tem uma janela propria, bem mais estreita.
   */
  private readonly limitadorDeSorteio = new RateLimiter(
    REALTIME_LIMITS.MAX_SORTEIOS_POR_JANELA,
    REALTIME_LIMITS.SORTEIO_JANELA_MS,
  );
  /**
   * Os comandos ja executados, um por jogador (DOC-036 item 130).
   *
   * Antes era um jornal de snapshots, e a Room precisava lembrar de capturar
   * ANTES de executar. Agora quem captura e o proprio comando: a Room so o
   * monta e entrega ao historico.
   */
  private readonly historico = new HistoricoDeComandos();
  /** Uso unico do seat token (FR-20): jti ja consumido nesta sala. */
  private readonly jtisUsados = new Set<string>();
  /**
   * Quem o anfitriao removeu. Um `client.leave()` partindo do SERVIDOR chega em
   * `onLeave` com `consented === false` — indistinguivel de uma queda de
   * conexao — e a sala guardaria o assento do expulso por 90 s esperando uma
   * reconexao que nao deve acontecer.
   */
  private readonly expulsos = new Set<string>();
  /**
   * CONTAS (`sub`) removidas da mesa. `expulsos` guarda sessionIds e é
   * esvaziado no `onLeave` — e cada entrada pede um seat token novo, com
   * sessionId novo. O expulso só precisava digitar o código da sala de novo
   * para voltar a sentar.
   */
  private readonly contasBanidas = new Set<string>();
  /** Descarte agendado da sala vazia — ver `agendarDescarteSeVazia`. */
  private descarteDaSalaVazia: { clear(): void } | null = null;
  /** Encerramento agendado da votação aberta — ver `agendarFimDaVotacao`. */
  private fimDaVotacao: { clear(): void } | null = null;
  private fimDaVotacaoAgendado = 0;
  private proximoAssento = 0;

  /**
   * ─── O QUE O RESUMO POS-PARTIDA PRECISA, E O ESTADO NAO TEM MAIS ──────────
   *
   * `onDispose` roda DEPOIS de todo mundo sair: nesse momento `state.players`
   * esta vazio e `clients` tambem. Perguntar ao estado quem jogou, ali, devolve
   * "ninguem" — e era assim que qualquer tentativa de gravar o resumo a partir
   * do estado registraria uma partida sem participantes.
   *
   * Por isso as duas coisas sao acumuladas ao longo da vida da sala.
   */
  /** Ids de CONTA (`sub` do seat token) que ocuparam assento. Nao inclui plateia. */
  private readonly contasQueJogaram = new Set<string>();
  /**
   * Ocupacao no AUGE, e nao no fim. Uma mesa de quatro que termina com um
   * jogador — porque tres sairam — foi uma partida de quatro.
   */
  private augeDeJogadores = 0;
  /** Epoch ms do primeiro START_MATCH. A duração da partida não inclui o lobby. */
  private inicioDaPartida = 0;
  /**
   * Versão do provisionamento de cada jogador. Duas escolhas de grimório em
   * sequência (setas no `<select>` do lobby) disparam dois `fetch`; sem saber
   * qual é o último, as duas respostas eram empilhadas no mesmo grimório.
   */
  private readonly provisionamento = new Map<string, number>();

  override onCreate(options: unknown): void {
    // O zod aqui e a correcao MINIMA do buraco de configuracao: as opcoes vem
    // do navegador e nao sao assinadas. `safeParse` e nao `parse` porque um
    // campo malformado nao pode impedir a sala de abrir — o que ele nao
    // reconhece cai no padrao, e e `normalizarConfigDeSala` quem decide o
    // resto. A correcao FORTE (config assinada) chega no `onAuth`.
    const brutas = OpcoesDeCriacao.safeParse(options);
    const opcoes = brutas.success ? brutas.data : {};

    this.setState(new RoomState());
    this.state.roomCode = opcoes.roomCode ?? this.roomId.slice(0, 6).toUpperCase();
    this.state.phase = 'WAITING';
    this.state.startedAt = Date.now();

    this.aplicarConfig(normalizarConfigDeSala(opcoes));

    // 20 Hz: mutacoes na mesma janela viram um patch. Arrastar uma carta nao
    // gera 60 pacotes por segundo.
    this.setPatchRate(REALTIME_LIMITS.PATCH_RATE_MS);

    this.registrarIntencoes();
    this.registrarIntencoesComIO();
    salasAtivas.inc();

    // Quem descarta a sala vazia é `agendarDescarteSeVazia`, não o Colyseus.
    // Agendar já aqui cobre a sala que ninguém chega a ocupar.
    this.autoDispose = false;
    this.agendarDescarteSeVazia();
  }

  /**
   * ─── A SALA PÚBLICA SUMIA DA VITRINE ───────────────────────────────────────
   *
   * Com o `autoDispose` padrão do Colyseus, a sala é destruída no instante em
   * que o último cliente sai. O criador de uma mesa pública não consegue estar
   * no lobby e na Taverna na mesma aba: bastava voltar para a lista para ver se
   * a mesa aparecia, e ela já não existia mais — "as salas que eu crio não
   * aparecem".
   *
   * Agora a sala vazia espera. Pública espera mais, porque é justamente quem
   * está na vitrine que alguém pode chegar a encontrar; privada espera o
   * bastante para um F5 ou um "voltar" acidental não custar a mesa e o convite.
   *
   * Vazia é sem clientes E sem jogador aguardando reconexão: quem caiu tem o
   * assento guardado por `RECONNECTION_WINDOW_S`, e descartar a sala antes
   * disso desfaria a reserva.
   */
  private agendarDescarteSeVazia(): void {
    this.cancelarDescarte();
    // Pelo ESTADO, e não por `this.clients`: dentro do `onLeave` o cliente que
    // está saindo pode ainda constar da lista, e a sala que acabou de esvaziar
    // nunca agendaria o próprio descarte — com o `autoDispose` desligado, ela
    // ficaria aberta para sempre.
    if (!this.salaVazia()) return;

    const espera = this.state.visibilidade === 'PUBLICA' ? 180_000 : 30_000;
    this.descarteDaSalaVazia = this.clock.setTimeout(() => {
      if (this.salaVazia() && this.clients.length === 0) void this.disconnect();
    }, espera);
  }

  private salaVazia(): boolean {
    return this.state.players.size === 0 && this.state.espectadores.size === 0;
  }

  /**
   * A votação vencida é ENCERRADA pelo servidor, no prazo.
   *
   * Antes ela só era varrida no voto seguinte, e o painel decidia sumir
   * comparando `votacaoExpiraEm` (relógio do servidor) com o relógio do
   * NAVEGADOR: com o relógio do jogador adiantado um minuto, a votação nunca
   * aparecia para ele; atrasado, aparecia depois de vencida. Agora a votação
   * aberta é `votacaoAlvo !== ''`, e quem a fecha é o servidor.
   */
  private agendarFimDaVotacao(): void {
    const { votacaoAlvo, votacaoExpiraEm } = this.state;
    if (!votacaoAlvo || this.fimDaVotacaoAgendado === votacaoExpiraEm) return;
    this.fimDaVotacao?.clear();
    this.fimDaVotacaoAgendado = votacaoExpiraEm;
    this.fimDaVotacao = this.clock.setTimeout(
      () => {
        this.fimDaVotacao = null;
        this.fimDaVotacaoAgendado = 0;
        if (this.state.votacaoAlvo && this.state.votacaoExpiraEm <= Date.now()) {
          this.state.votacaoAlvo = '';
          this.state.votacaoAutor = '';
          this.state.votacaoSim = '';
          this.state.votacaoExpiraEm = 0;
        }
      },
      Math.max(0, votacaoExpiraEm - Date.now()) + 50,
    );
  }

  private cancelarDescarte(): void {
    this.descarteDaSalaVazia?.clear();
    this.descarteDaSalaVazia = null;
  }

  /**
   * Grava uma configuracao JA NORMALIZADA no estado.
   *
   * Um caminho so para os dois momentos em que a config chega — o `onCreate`,
   * com o que o navegador mandou, e o `onAuth` do criador, com o que a API
   * assinou. Duas escritas separadas divergiriam, e a divergencia apareceria
   * como um campo que o passe assinado nao consegue corrigir.
   */
  private aplicarConfig(config: ConfigDeSala): void {
    /**
     * ─── `maxClients` DO COLYSEUS != ASSENTOS DA MESA ──────────────────────
     *
     * Eram a mesma coisa ate o modo espectador existir, e a diferenca e a razao
     * de ele funcionar numa mesa cheia — que e justamente a mesa que alguem
     * quer assistir.
     *
     * O Colyseus tranca a sala em `hasReachedMaxClients()`, e a checagem
     * acontece no MATCHMAKING, antes do `onAuth`. Com `maxClients` igual aos
     * assentos, o espectador seria recusado antes de o servidor sequer abrir o
     * passe dele e descobrir que ele nao queria assento nenhum.
     *
     * Entao `maxClients` passa a ser assentos + plateia, e A LOTACAO DE
     * JOGADORES VIRA RESPONSABILIDADE NOSSA — ela e checada no `onAuth`, que
     * lanca `ROOM_FULL`. Isto e uma transferencia real de responsabilidade do
     * framework para este arquivo: se a checagem do `onAuth` sumir numa
     * refatoracao, a mesa passa a aceitar dezoito jogadores em silencio.
     *
     * `state.maxSeats` continua sendo o numero de ASSENTOS, e e ele que o lobby
     * e a mesa desenham. O PISO DE 1 vem de `normalizarConfigDeSala` e importa:
     * DOC-037 §7.1 chama o `solo` de caso de uso numero 1 do documento de visao
     * ("O Testador — vale a pena comprar?"). Um `Math.max(2, ...)` ja quebrou
     * isso uma vez — o preset de solo pedia uma mesa de um, a sala abria com
     * dois assentos, e o painel mostrava um lugar vazio esperando alguem que
     * nunca vinha.
     */
    // No TETO, e não nos assentos da config: o anfitrião pode abrir vagas no
    // lobby (`INTENT_SET_ROOM_CONFIG.maxSeats`), e um `maxClients` preso ao
    // número da criação recusaria o quinto jogador no matchmaking antes de o
    // `onAuth` ver o assento novo.
    this.maxClients = REALTIME_LIMITS.MAX_PLAYERS + REALTIME_LIMITS.MAX_ESPECTADORES;
    this.state.maxSeats = config.maxClients;
    this.state.gameType = config.gameType;
    // O mulligan nascia 'COMMANDER' em TODA sala: uma mesa de Modern 1v1 dava
    // o primeiro mulligan de graça, que a regra (103.5c) só concede com zona de
    // comando / multiplayer. Formato sem comandante começa em London; o
    // anfitrião continua podendo trocar na sala de espera.
    this.state.tipoDeMulligan = acharFormato(config.gameType).comandante ? 'COMMANDER' : 'LONDON';

    this.state.nome = config.nome;
    this.state.visibilidade = config.visibilidade;
    this.state.comunicacao = config.comunicacao;
    this.state.idioma = config.idioma;
    // 0 = nao declarado. Ver o campo em `RoomState`.
    this.state.nivelDePoder = config.nivelDePoder ?? 0;

    this.publicarMetadados();
  }

  /**
   * Publica a sala no matchMaker — ou a esconde.
   *
   * METADADO, e nao estado: e o que `matchMaker.query` consulta SEM abrir a
   * sala nem tocar no `RoomState`. Uma lista publica que precisasse instanciar
   * cada sala para saber o nome dela nao escalaria alem de algumas dezenas.
   *
   * So sala PUBLICA e publicada. Privada significa nao listada (nao existe
   * senha de sala — o `seatToken` ja governa a entrada), e a forma de honrar
   * isso e nao ter nada para o `GET /salas` encontrar.
   */
  private publicarMetadados(): void {
    if (this.state.visibilidade !== 'PUBLICA') {
      void this.setMetadata({ visibilidade: 'PRIVADA' });
      return;
    }

    void this.setMetadata({
      visibilidade: 'PUBLICA',
      roomCode: this.state.roomCode,
      nome: this.state.nome,
      gameType: this.state.gameType,
      comunicacao: this.state.comunicacao,
      idioma: this.state.idioma,
      nivelDePoder: this.state.nivelDePoder,
      // A ocupacao vive no metadado porque a lista precisa dela para decidir
      // entre "Entrar" e "Assistir", e `clients.length` nao atravessa o
      // matchMaker por conta propria.
      ocupacao: this.state.players.size,
      espectadores: this.state.espectadores.size,
      maxSeats: this.state.maxSeats,
      emPartida: this.state.phase === 'PLAYING',
    });
  }

  /**
   * Valida o seat token: assinatura, expiracao, uso unico e vinculo com o
   * roomId (FR-20). Falhar aqui e a primeira linha de defesa da sala.
   */
  override async onAuth(client: Client, options: JoinOptions): Promise<SeatTokenClaims> {
    if (!options?.seatToken) {
      throw new Error('INVALID_TOKEN');
    }

    let claims: SeatTokenClaims;
    try {
      claims = jwt.verify(options.seatToken, config.JWT_SECRET) as SeatTokenClaims;
    } catch (erro) {
      // jsonwebtoken distingue expirado de invalido; o cliente merece saber qual.
      const expirado = erro instanceof jwt.TokenExpiredError;
      throw new Error(expirado ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN');
    }

    // Vinculo com a sala: um token emitido para outra sala nao serve aqui.
    if (claims.roomId && claims.roomId !== this.state.roomCode) {
      throw new Error('INVALID_TOKEN');
    }

    if (claims.jti && this.jtisUsados.has(claims.jti)) throw new Error('TOKEN_ALREADY_USED');

    // Removido da mesa (pelo anfitrião ou por votação) não volta — nem como
    // espectador, que veria a mesa de quem acabou de tirá-lo dela.
    if (claims.sub && this.contasBanidas.has(claims.sub)) throw new Error('PLAYER_BLOCKED');

    /**
     * ─── A CONFIGURACAO ASSINADA SOBREPOE A QUE VEIO DO NAVEGADOR ──────────
     *
     * `onCreate` recebe as opcoes CRUAS do `joinOrCreate` — escritas pelo
     * cliente, sem assinatura nenhuma. Ele ja as normaliza contra o catalogo de
     * formatos, o que fecha o caso grosseiro (oito assentos em Duel Commander),
     * mas nada ali distingue "o criador escolheu isto" de "alguem editou a
     * querystring".
     *
     * A claim `cfg` vem dentro do seat token, que a API Core assinou. Aplicar
     * aqui e o unico ponto possivel: o Colyseus nao entrega o resultado do
     * `onAuth` ao `onCreate`, que roda antes.
     *
     * A GUARDA E `players.size === 0`, e nao "e o assento 0".
     *
     * O criador e sempre o primeiro a autenticar, entao a sala vazia identifica
     * exatamente ele. Usar o assento seria pior: `removerJogador` reatribui
     * assentos a cada saida, entao o assento 0 e um papel que muda de dono
     * durante a partida — e quem herdasse o papel reescreveria a mesa inteira
     * apresentando um passe emitido para outra configuracao.
     */
    if (claims.cfg && this.state.players.size === 0) {
      this.aplicarConfig(normalizarConfigDeSala(claims.cfg));
    }

    /**
     * ─── A MESMA CONTA NÃO SENTA DUAS VEZES ─────────────────────────────────
     *
     * Ninguém comparava o `sub` do passe com os jogadores já sentados. Quem
     * caía e voltava pelo código da sala (aba nova, navegador reaberto — a
     * chave de reconexão mora no `sessionStorage` e não sobrevive) ganhava um
     * SEGUNDO assento, e o primeiro ficava ocupando vaga pelos dez minutos da
     * janela de reconexão. Numa mesa de cinco, era o quinto quem ficava de fora.
     *
     * Conectado: recusa — é a mesma pessoa em duas abas. Desconectado: o
     * assento antigo é liberado agora. A mesa perde as cartas dele, mas é o
     * mesmo resultado de esperar a janela vencer, sem o fantasma no meio.
     */
    if (!claims.spectator && claims.sub) {
      const mesmo = Array.from(this.state.players.values()).find((p) => p.userId === claims.sub);
      if (mesmo?.connected) throw new Error('ALREADY_SEATED');
      if (mesmo) {
        this.publicarLog(
          logSistema(
            mesmo.id,
            `${mesmo.name} voltou por um passe novo; o assento antigo foi liberado`,
          ),
        );
        this.removerJogador(mesmo.id);
      }
    }

    /**
     * ─── A LOTACAO DE JOGADORES E CHECADA AQUI, E SO AQUI ──────────────────
     *
     * Ate o modo espectador existir, quem recusava o jogador excedente era o
     * proprio Colyseus, em `hasReachedMaxClients()`. Agora `this.maxClients`
     * inclui a plateia (ver `aplicarConfig`), entao aquela checagem passou a
     * deixar entrar muito mais gente do que ha assento — e sem esta linha a
     * mesa aceitaria dezoito jogadores sem reclamar.
     *
     * `ROOM_FULL` ja e um dos `HANDSHAKE_ERRORS` do contrato, e o cliente ja
     * tem a frase certa para ele.
     *
     * A contagem e de `state.players`, e nao de `clients`: o segundo inclui a
     * plateia, e uma mesa com quatro assentos e tres espectadores recusaria o
     * quarto jogador.
     */
    if (!claims.spectator && !haAssentoLivre(this.state)) {
      throw new Error('ROOM_FULL');
    }
    // A plateia tem teto próprio. `maxClients` é assentos + plateia somados, e
    // com a mesa ainda vazia de jogadores a sala aceitava dezoito espectadores
    // — as vagas de assento viravam lugar na arquibancada.
    if (claims.spectator && this.state.espectadores.size >= REALTIME_LIMITS.MAX_ESPECTADORES) {
      throw new Error('ROOM_FULL');
    }

    // O passe só é CONSUMIDO aqui, depois de a vaga ser confirmada. Antes ele
    // era marcado logo após a assinatura: o quinto jogador recebia "mesa
    // cheia", e quando uma vaga abria o mesmo link respondia "token já usado"
    // — que parecia defeito, e não lotação. Não há `await` entre a checagem e
    // a marcação, então duas entradas não disputam o mesmo passe.
    if (claims.jti) this.jtisUsados.add(claims.jti);

    return claims;
  }

  override onJoin(client: Client, options: JoinOptions, auth: SeatTokenClaims): void {
    // `ws_connections_active` e `ws_reconnections_total` eram expostas em
    // /metrics e NUNCA atualizadas: o painel mostrava zero jogadores conectados
    // com a mesa cheia. Cada cliente que entra (jogador ou plateia) conta um;
    // cada `onLeave` desconta.
    conexoesAtivas.inc();
    if (auth.spectator) {
      this.entrarComoEspectador(client, auth);
      return;
    }

    this.cancelarDescarte();

    const player = new Player();
    player.id = client.sessionId;
    player.userId = auth.sub;
    player.name = auth.username;
    // Quem chega com a partida andando nasceria com 40 em qualquer formato:
    // `Player.life` tem 40 fixo no schema.
    player.life = vidaInicialDaMesa(this.state);
    player.seat = this.proximoAssento;
    this.proximoAssento += 1;

    this.state.players.set(client.sessionId, player);
    // Para o resumo pos-partida — ver `contasQueJogaram`. So com a partida
    // RODANDO: quem passou pela sala de espera e saiu antes do inicio nao jogou,
    // e uma mesa publica com entra-e-sai passava de oito participantes — o
    // backend recusa o resumo acima de MAX_PLAYERS e a partida nao era gravada.
    if (this.state.phase === 'PLAYING') this.registrarParticipantes();

    // Toda zona do jogador nasce com sua lista de ordem.
    for (const zone of ZONES) {
      this.state.zoneOrder.set(zoneOrderKey(client.sessionId, zone), new ZoneOrderList());
    }

    // Quem trouxe deck no passe (fluxo antigo, ou entrada direta por link) ja
    // chega provisionado. Quem nao trouxe escolhe na sala de espera.
    if (auth.deckId) {
      void this.provisionarDeck(client.sessionId, auth.deckId);
    }

    // O cliente precisa de uma StateView antes do primeiro patch, senao veria
    // todos os campos marcados com view().
    reconciliarClient(client, this.state);

    // NAO marcar 'PLAYING' aqui. A sala nasce em WAITING e so sai dai por
    // INTENT_START_MATCH, disparado pelo anfitriao na sala de espera. Antes o
    // primeiro `onJoin` ja colocava a mesa em jogo, e por isso a tela de
    // gerenciamento da sala nunca tinha oportunidade de aparecer.
    //
    // Excecao: quem entra numa partida JA em andamento (reconexao com assento
    // novo, ou convidado tardio) entra direto no jogo — a fase ja e 'PLAYING'
    // e nada aqui a altera.

    this.broadcast('playerJoined', { playerId: client.sessionId, name: player.name });
    this.publicarLog(logSistema(client.sessionId, `${player.name} entrou na mesa`));

    // A ocupacao mudou: sem isto a lista publica mostraria "1/4" numa mesa que
    // ja encheu, e o botao "Entrar" levaria a um ROOM_FULL.
    this.publicarMetadados();
  }

  /**
   * Entrada de quem so vai olhar.
   *
   * Repare no que NAO acontece aqui: nenhuma lista de zona e criada, nenhum
   * deck e provisionado, nenhum assento e reservado, e `proximoAssento` nao
   * anda. Um espectador nao deixa rastro na mesa — e por isso a saida dele
   * tambem nao precisa de `reconciliarTudo`.
   */
  private entrarComoEspectador(client: Client, auth: SeatTokenClaims): void {
    this.cancelarDescarte();
    const espectador = new Espectador();
    espectador.id = client.sessionId;
    espectador.userId = auth.sub;
    espectador.name = auth.username;
    this.state.espectadores.set(client.sessionId, espectador);

    // A view precisa existir antes do primeiro patch, igual ao jogador. A dele
    // e a mais barata que existe: `podeVer` nega toda zona oculta para quem nao
    // e dono nem controller, e ele nao e nenhum dos dois em carta nenhuma.
    reconciliarClient(client, this.state);

    this.broadcast('spectatorJoined', {
      spectatorId: client.sessionId,
      name: espectador.name,
    });
    this.publicarLog(logSistema(client.sessionId, `${espectador.name} está assistindo`));
    this.publicarMetadados();
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    conexoesAtivas.dec();
    /**
     * Espectador sai NA HORA, sem janela de reconexao.
     *
     * Os 90 s de `allowReconnection` existem para guardar o ASSENTO e as cartas
     * de quem caiu. Espectador nao tem nem um nem outro: segurar a saida dele
     * so faria a lista da mesa mostrar plateia que ja foi embora, e ainda
     * ocuparia uma das dez vagas de `MAX_ESPECTADORES`.
     */
    if (this.state.espectadores.has(client.sessionId)) {
      const espectador = this.state.espectadores.get(client.sessionId);
      this.state.espectadores.delete(client.sessionId);
      this.rateLimiter.esquecer(client.sessionId);
      this.broadcast('spectatorLeft', {
        spectatorId: client.sessionId,
        name: espectador?.name ?? '',
      });
      this.publicarMetadados();
      this.agendarDescarteSeVazia();
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
      player.disconnectedAt = Date.now();
    }

    // Libera qualquer lock de arraste que o jogador estivesse segurando: sem
    // isso a carta fica travada para todos ate o TTL expirar.
    this.state.cards.forEach((card) => {
      if (card.lockedBy === client.sessionId) card.lockedBy = '';
    });

    // Saida consentida (o jogador clicou em sair) ou expulsao pelo anfitriao:
    // nos dois casos o assento vai embora agora. Guardar a vaga do expulso por
    // 90 s seria desfazer o chute na pratica — a sala continuaria cheia.
    if (consented || this.expulsos.has(client.sessionId)) {
      this.expulsos.delete(client.sessionId);
      this.removerJogador(client.sessionId);
      return;
    }

    this.broadcast('playerDisconnected', { playerId: client.sessionId });

    try {
      await this.allowReconnection(client, REALTIME_LIMITS.RECONNECTION_WINDOW_S);
      conexoesAtivas.inc();
      // A mesma conta pode ter voltado por um passe novo enquanto esta aba
      // estava fora (`onAuth` libera o assento antigo). A aba antiga que
      // reconecta depois disso não tem mais assento: ficaria na sala como um
      // cliente sem jogador, vendo a mesa sem ser plateia nem mesa.
      if (!this.state.players.has(client.sessionId)) {
        reconexoes.inc({ result: 'sem-assento' });
        client.leave(4001);
        return;
      }
      reconexoes.inc({ result: 'ok' });
      if (player) {
        player.connected = true;
        player.disconnectedAt = 0;
      }
      // A view nao sobrevive a reconexao: reconstruir e obrigatorio.
      reconciliarClient(client, this.state);
      this.broadcast('playerReconnected', { playerId: client.sessionId });
    } catch {
      reconexoes.inc({ result: 'expirou' });
      this.removerJogador(client.sessionId);
    }
  }

  override onDispose(): void {
    salasAtivas.dec();
    // Sem `await`: `onDispose` nao espera promessa, e segurar o encerramento da
    // sala por uma chamada HTTP atrasaria a liberacao do processo.
    void this.registrarResumoDaPartida();
  }

  /**
   * ─── "PARTIDAS JOGADAS" ERA SEMPRE 0, EM TODO PERFIL ──────────────────────
   *
   * `prisma.matchSummary.create` nao existia em lugar nenhum do repositorio —
   * so `.count()`. As tabelas `match_summaries` e `match_participants` nunca
   * receberam uma linha, e o efeito aparecia em tres telas ao mesmo tempo: o
   * perfil proprio, o perfil publico e a metrica do backoffice. Nenhuma
   * estatistica de jogador era possivel.
   *
   * O gancho e este `onDispose` porque e o UNICO momento em que alguem sabe que
   * a partida acabou e quanto ela durou. Nao ha evento de "fim de jogo" no
   * motor: nao existe motor de regras (RN01), a mesa acaba quando as pessoas
   * saem.
   *
   * ─── SALA QUE NUNCA COMECOU NAO E PARTIDA ─────────────────────────────────
   *
   * `startedAt` marca a criacao da SALA, nao o inicio do jogo. Uma sala aberta
   * por engano e fechada em dez segundos registraria uma "partida jogada" para
   * quem entrou — inflando a estatistica de todo mundo que so espiou um lobby.
   * Por isso a guarda e `turnoIniciadoEm`, que so e escrito por
   * `INTENT_START_MATCH`.
   *
   * Falhar aqui NAO pode derrubar nada: a sala ja acabou e nao ha ninguem para
   * avisar. Vira log.
   */
  private registrarParticipantes(): void {
    this.state.players.forEach((p) => {
      if (p.userId) this.contasQueJogaram.add(p.userId);
    });
    this.augeDeJogadores = Math.max(this.augeDeJogadores, this.state.players.size);
  }

  private async registrarResumoDaPartida(): Promise<void> {
    if (!this.state.turnoIniciadoEm) return;
    if (this.contasQueJogaram.size === 0) return;

    // Do START_MATCH, nao da criacao da sala: a duracao incluia o lobby e a
    // espera de descarte da sala vazia.
    const inicio = this.inicioDaPartida || this.state.startedAt;
    const duracao = Math.max(0, Math.round((Date.now() - inicio) / 1000));

    try {
      const res = await fetch(`${config.BACKEND_CORE_URL}/api/v1/internal/matches/summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.INTERNAL_API_TOKEN ? { 'X-Internal-Token': config.INTERNAL_API_TOKEN } : {}),
        },
        body: JSON.stringify({
          roomCode: this.state.roomCode,
          playerCount: this.augeDeJogadores,
          durationSeconds: duracao,
          participantes: Array.from(this.contasQueJogaram).slice(0, REALTIME_LIMITS.MAX_PLAYERS),
        }),
      });
      if (!res.ok) {
        console.error(`[${this.roomId}] resumo da partida recusado: ${res.status}`);
      }
    } catch (erro) {
      console.error(`[${this.roomId}] falha ao registrar o resumo da partida:`, erro);
    }
  }

  // ─── Intencoes ─────────────────────────────────────────────────────────────

  private registrarIntencoes(): void {
    // O genérico de `IntentHandler` e apagado aqui de proposito. Dentro de cada
    // entrada, `schema` e `executa` sao correlacionados; ao iterar a tabela, o
    // TypeScript intersecta todos os payloads e nenhum valor satisfaz o
    // resultado. A correlacao real e garantida pelo `satisfies` na declaracao do
    // REGISTRY — o dispatcher so precisa saber "valida, autoriza, executa".
    const entradas = Object.entries(REGISTRY) as Array<[string, IntentHandler<z.ZodTypeAny>]>;

    for (const [tipo, handler] of entradas) {
      this.onMessage(tipo, (client, payload: unknown) => {
        // Rate limit antes de qualquer trabalho: 30 intencoes/s (NFR-04).
        if (!this.rateLimiter.permitir(client.sessionId)) {
          intentsRejeitadas.inc({ reason: 'rate_limit' });
          client.send('warning', {
            code: 'RATE_LIMITED',
            message: 'Muitas ações por segundo. Algumas foram descartadas.',
          });
          return;
        }

        // Sorteios tem janela propria — ver `limitadorDeSorteio`.
        if (INTENCOES_DE_SORTEIO.has(tipo) && !this.limitadorDeSorteio.permitir(client.sessionId)) {
          intentsRejeitadas.inc({ reason: 'too_many_rolls' });
          client.send('warning', {
            code: 'RATE_LIMITED',
            message: `Calma com os sorteios: até ${REALTIME_LIMITS.MAX_SORTEIOS_POR_JANELA} a cada ${Math.round(REALTIME_LIMITS.SORTEIO_JANELA_MS / 1000)} s.`,
          });
          return;
        }

        /**
         * ─── ESPECTADOR NAO MEXE NA MESA ───────────────────────────────────
         *
         * `verificarAutorizacao` NAO cobre isto, e e importante entender por
         * que: ela devolve `null` na hora para `QUALQUER_JOGADOR`, sem checar
         * se o remetente e mesmo um jogador — o nome da regra sempre foi uma
         * promessa que ninguem verificava, porque ate agora todo mundo na sala
         * tinha assento.
         *
         * A barreira fica AQUI, e nao dentro de cada handler, pelo mesmo motivo
         * de `exigirAnfitriao` existir: a proxima intencao nasce protegida em
         * vez de nascer aberta. Espalhar a checagem por 90 handlers e como
         * garantir que os 90 lembrem — e os que esquecessem falhariam em
         * silencio, porque quase todos comecam com um
         * `state.players.get(sid)` que devolve `undefined` e sai calado.
         *
         * O CHAT E A UNICA EXCECAO. Quem assiste comenta a partida; e o
         * conteudo inteiro de assistir. Ele nao muta estado nenhum — so
         * transmite texto que o servidor ja limpa de caracteres de controle.
         */
        if (espectadorBarrado(this.state, client.sessionId, tipo)) {
          intentsRejeitadas.inc({ reason: 'spectator' });
          client.send('error', {
            code: 'SPECTATOR',
            message: 'Você está assistindo a esta mesa. Só quem tem assento pode agir nela.',
            intent: tipo,
          });
          return;
        }

        const parsed = handler.schema.safeParse(payload);
        if (!parsed.success) {
          intentsRejeitadas.inc({ reason: 'invalid_payload' });
          // Nunca inclui nome de carta na mensagem de erro (DOC-031 §5.4).
          client.send('error', {
            code: 'INVALID_PAYLOAD',
            message: 'Ação rejeitada: o formato do pedido é inválido.',
            intent: tipo,
          });
          return;
        }

        const negado = verificarAutorizacao(handler, this.state, client.sessionId, parsed.data);
        if (negado) {
          intentsRejeitadas.inc({ reason: negado.toLowerCase() });
          client.send('error', { code: negado, message: 'Ação não permitida.', intent: tipo });
          return;
        }

        try {
          // A fase e lida ANTES para saber se o handler a mudou. START_MATCH e
          // RESET_MATCH viram `emPartida` na lista publica, e o REGISTRY nao
          // tem — nem deve ter — acesso a Room para publicar isso sozinho.
          const faseAntes = this.state.phase;
          const contexto = this.montarContexto(client);

          /**
           * A INTENCAO VIRA UM COMANDO, E E O HISTORICO QUE A EXECUTA.
           *
           * O snapshot para o undo sai de dentro do comando, imediatamente
           * antes da mutacao. Enquanto eram duas chamadas aqui — capturar,
           * depois executar — nada impedia que alguem as reordenasse, e um
           * snapshot tirado DEPOIS faz o undo restaurar exatamente o estado
           * que o jogador queria desfazer, sem erro nenhum na tela.
           */
          this.historico.executar(
            new ComandoDeIntencao(tipo, handler, contexto, parsed.data, this.state),
          );
          this.agendarFimDaVotacao();
          if (this.state.phase !== faseAntes) {
            this.publicarMetadados();
            if (this.state.phase === 'PLAYING') {
              if (!this.inicioDaPartida) this.inicioDaPartida = Date.now();
              this.registrarParticipantes();
            }
          }

          /**
           * ─── O TOPO REVELADO SE REAPLICA AQUI, E SO AQUI ────────────────
           *
           * Dez intencoes mudam o topo do grimorio (comprar, moer, embaralhar,
           * mulligan, topo-para-o-fundo, reordenar, confirmar scry, confirmar
           * surveil, devolver zona, mover carta para o grimorio). Chamar a
           * reaplicacao dentro de cada uma seria dez chances de esquecer — e o
           * modo de falhar do esquecimento nao e a carta sumir da tela, e uma
           * carta que DEIXOU de ser o topo continuar revelada para a mesa.
           *
           * Aqui e um ponto so, e ele e correto por construcao: nao existe
           * caminho que mude o estado sem passar por um handler.
           *
           * So o remetente: ninguem move carta para o grimorio de outro
           * jogador. `INTENT_GIVE_CARD` troca o controlador de uma permanente,
           * nao a zona. A funcao e idempotente, entao nas intencoes que nao
           * tocam o grimorio ela nao escreve nada e nao gera patch.
           */
          aplicarTopoRevelado(contexto, client.sessionId);

          intentsRecebidas.inc({ type: tipo });
        } catch (erro) {
          // Uma intencao malformada NUNCA deve derrubar a sala dos outros tres
          // jogadores. Loga com o roomId e responde erro genérico.
          intentsRejeitadas.inc({ reason: 'internal' });
          console.error(`[${this.roomId}] handler ${tipo} falhou:`, erro);
          client.send('error', {
            code: 'INTERNAL',
            message: 'Erro interno na mesa. A ação não foi aplicada.',
            intent: tipo,
          });
        }
      });
    }
  }

  private montarContexto(client: Client): IntentContext {
    return {
      state: this.state,
      client,
      clients: this.clients,
      send: (event, payload) => client.send(event, payload),
      broadcast: (event, payload) => this.broadcast(event, payload),
      log: (entrada) => this.publicarLog(entrada),
      desfazer: () => this.historico.desfazer(client.sessionId),
      expulsar: (sessionId) => this.expulsar(sessionId),
      aoMudarLotacao: () => this.publicarMetadados(),
    };
  }

  private publicarLog(entrada: LogEvent): void {
    this.broadcast('log', entrada);
  }

  /**
   * Tira alguem da sala AGORA — sem janela de reconexao.
   *
   * Mora na Room, e nao no handler de `INTENT_KICK_PLAYER`, porque so aqui da
   * para marcar a saida como intencional antes de o socket cair: `onLeave` nao
   * recebe o codigo de fechamento, so o booleano `consented`, que e falso
   * tanto para "fui expulso" quanto para "o wi-fi caiu".
   */
  private expulsar(sessionId: string): void {
    this.expulsos.add(sessionId);
    const conta = this.state.players.get(sessionId)?.userId;
    if (conta) this.contasBanidas.add(conta);
    const client = this.clients.find((c) => c.sessionId === sessionId);
    // 4000+ e a faixa de codigos de aplicacao do WebSocket: o cliente distingue
    // "fui removido" de "a conexao caiu".
    if (client) {
      client.leave(4001);
      return;
    }
    // DESCONECTADO: o Colyseus ja tirou o cliente de `this.clients`, entao o
    // `leave` acima nao tinha em quem agir. O expulso seguia ocupando a vaga
    // pela janela de reconexao inteira — e a chave de reconexao dele pula o
    // `onAuth`, entao ele voltava a sentar apesar do bloqueio da conta. Sai
    // agora; se a aba dele reconectar, `onLeave` a recusa por nao ter assento.
    this.expulsos.delete(sessionId);
    this.removerJogador(sessionId);
  }

  /**
   * Intencoes que precisam de I/O, e por isso NAO cabem no REGISTRY.
   *
   * A regra de DOC-021 §7 e que o handler de intencao seja sincrono: um `await`
   * no caminho critico segura a fila de mensagens da sala inteira. `SET_DECK`
   * precisa buscar o decklist na API Core, entao ela vive aqui, ao lado de
   * `provisionarDeck` — que ja fazia exatamente isso no `onJoin`, tambem fora
   * do caminho critico.
   */
  private registrarIntencoesComIO(): void {
    this.onMessage('INTENT_SET_DECK', (client, payload: unknown) => {
      if (!this.rateLimiter.permitir(client.sessionId)) return;

      // Esta intencao NAO passa pelo dispatcher do REGISTRY (ela faz I/O), e
      // por isso a barreira de espectador de la nao a alcanca. Sem esta linha,
      // quem assiste escolheria um grimorio e o servidor tentaria provisiona-lo
      // para um sessionId que nao tem zona nenhuma.
      if (this.state.espectadores.has(client.sessionId)) {
        client.send('error', {
          code: 'SPECTATOR',
          message: 'Você está assistindo a esta mesa. Só quem tem assento escolhe grimório.',
          intent: 'INTENT_SET_DECK',
        });
        return;
      }

      const deckId = (payload as { deckId?: unknown })?.deckId;
      if (typeof deckId !== 'string' || !UUID.test(deckId)) {
        client.send('error', {
          code: 'INVALID_PAYLOAD',
          message: 'Grimório inválido.',
          intent: 'INTENT_SET_DECK',
        });
        return;
      }

      // Trocar de deck no meio da partida seria trocar de baralho com o jogo em
      // andamento. So na sala de espera — com UMA excecao: quem entrou com a
      // partida rodando e ainda nao tem carta nenhuma. "Entrar" pela lista
      // publica manda um passe sem deck, e a recusa deixava a pessoa sentada,
      // sem grimorio, assistindo a mesa para sempre.
      const semCartas = !Array.from(this.state.cards.values()).some(
        (c) => c.ownerId === client.sessionId && !c.isToken,
      );
      if (this.state.phase !== 'WAITING' && !(this.state.phase === 'PLAYING' && semCartas)) {
        client.send('error', {
          code: 'NOT_AUTHORIZED',
          message: 'O grimório só pode ser escolhido antes de a partida começar.',
          intent: 'INTENT_SET_DECK',
        });
        return;
      }

      void this.provisionarDeck(client.sessionId, deckId);
    });
  }

  /**
   * Apaga o que um deck anterior deixou na mesa.
   *
   * Trocar de grimorio na sala de espera sem isto empilhava os dois: o segundo
   * deck era EMPURRADO para dentro das mesmas listas de zona, e o jogador
   * comecava a partida com 200 cartas no grimorio e dois comandantes.
   */
  private limparCartasDe(sessionId: string): void {
    for (const zone of ZONES) {
      const lista = this.state.zoneOrder.get(zoneOrderKey(sessionId, zone))?.items;
      lista?.splice(0, lista.length);
    }
    this.state.cards.forEach((card, id) => {
      if (card.ownerId === sessionId) this.state.cards.delete(id);
    });
  }

  private removerJogador(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    // Idempotente: a conta que volta por passe novo libera o assento antigo no
    // `onAuth`, e a janela de reconexão dele ainda vence depois e chama isto
    // de novo — sem a guarda, a mesa anunciaria a saída duas vezes.
    if (!player) return;
    const assentoQueSaiu = player.seat;
    this.state.players.delete(sessionId);
    this.provisionamento.delete(sessionId);
    // A votacao sobre quem saiu nao tem mais objeto; a de quem propos, sem o
    // autor na mesa, nao tem mais quem a sustente.
    if (this.state.votacaoAlvo === sessionId || this.state.votacaoAutor === sessionId) {
      this.state.votacaoAlvo = '';
      this.state.votacaoAutor = '';
      this.state.votacaoSim = '';
      this.state.votacaoExpiraEm = 0;
    }
    this.rateLimiter.esquecer(sessionId);
    this.historico.esquecer(sessionId);

    for (const zone of ZONES) {
      this.state.zoneOrder.delete(zoneOrderKey(sessionId, zone));
    }
    this.state.cards.forEach((card, id) => {
      if (card.ownerId === sessionId) this.state.cards.delete(id);
      // Carta de OUTRO dono sob controle de quem saiu ficava apontando para um
      // jogador inexistente: ninguém podia movê-la e ela não era desenhada em
      // faixa nenhuma. O controle volta ao dono.
      else if (card.controllerId === sessionId) card.controllerId = card.ownerId;
    });

    // Reatribui assentos: `proximoAssento` so crescia, entao apos qualquer
    // saida ninguem mais ocupava o assento 0 — e sem assento 0 nao existe
    // anfitriao para iniciar a partida.
    const restantes = Array.from(this.state.players.values()).sort((a, b) => a.seat - b.seat);
    restantes.forEach((p, indice) => {
      p.seat = indice;
    });
    this.proximoAssento = restantes.length;

    /**
     * A VEZ NAO PODE FICAR COM QUEM SAIU.
     *
     * `activePlayerId` continuava apontando para o jogador removido, e
     * `exigirVez` recusava todo mundo com NOT_YOUR_TURN — a mesa travava ate
     * alguem reiniciar a partida. A vez passa para quem herdou o assento (o
     * proximo na ordem), ou para o primeiro se quem saiu era o ultimo.
     */
    if (this.state.activePlayerId === sessionId) {
      const proximo = restantes[assentoQueSaiu] ?? restantes[0];
      this.state.activePlayerId = proximo?.id ?? '';
      this.state.turnoIniciadoEm = proximo ? Date.now() : 0;
    }
    if (this.state.jogadorInicial === sessionId) this.state.jogadorInicial = '';

    this.broadcast('playerLeft', { playerId: sessionId, name: player?.name ?? '' });

    // Uma vaga abriu: a mesa volta para a lista publica com "Entrar" em vez de
    // "Assistir".
    this.publicarMetadados();

    // Setas de quem saiu, ou que apontavam para ele ou para as cartas dele, nao
    // tem mais ponta: ficavam no estado e reapareciam se o id voltasse a valer.
    const existe = (id: string) => this.state.cards.has(id) || this.state.players.has(id);
    this.state.arrows.forEach((seta, chave) => {
      if (seta.ownerId === sessionId || !existe(seta.fromId) || !existe(seta.toId)) {
        this.state.arrows.delete(chave);
      }
    });

    // As cartas do jogador sairam: as views dos demais precisam ser recalculadas.
    reconciliarTudo(this.clients, this.state);

    // O ULTIMO OPONENTE SAIR TAMBEM DECIDE A PARTIDA. So eliminacao chamava a
    // verificacao: com A vivo, C fora e B saindo da sala, a mesa ficava em
    // PLAYING para sempre e ninguem era anunciado vencedor.
    verificarFimDePartida({
      state: this.state,
      broadcast: (event, payload) => this.broadcast(event, payload),
      log: (entrada) => this.publicarLog(entrada),
    });

    /**
     * SOBROU UM JOGADOR: ELE VENCEU.
     *
     * `verificarFimDePartida` exige dois jogadores na mesa — e precisa exigir,
     * senão a mesa de teste solo terminaria no primeiro clique. Mas numa partida
     * que COMEÇOU com dois ou mais, ficar sozinho porque o último oponente saiu
     * é vitória: num 1v1, o oponente fechar a aba deixava a partida aberta para
     * sempre, sem vencedor nenhum anunciado.
     */
    if (
      this.state.phase === 'PLAYING' &&
      this.state.players.size === 1 &&
      this.augeDeJogadores >= 2
    ) {
      const vencedor = Array.from(this.state.players.values())[0]!;
      this.state.phase = 'CLOSING';
      this.broadcast('matchEnded', { winnerId: vencedor.id, winnerName: vencedor.name });
      this.publicarLog(logSistema(vencedor.id, `${vencedor.name} venceu a partida`));
    }

    this.agendarDescarteSeVazia();
  }

  // ─── Provisionamento de deck ───────────────────────────────────────────────

  /**
   * Carrega o deck real da API Core.
   *
   * A chamada acontece em `onJoin`, que e assincrono — FORA do caminho critico
   * de intencoes (DOC-021 §7), que precisa continuar sincrono.
   */
  private async provisionarDeck(sessionId: string, deckId: string): Promise<void> {
    const grimorio = this.state.zoneOrder.get(zoneOrderKey(sessionId, 'LIBRARY'))?.items;
    const mao = this.state.zoneOrder.get(zoneOrderKey(sessionId, 'HAND'))?.items;
    const comando = this.state.zoneOrder.get(zoneOrderKey(sessionId, 'COMMAND'))?.items;
    if (!grimorio || !mao || !comando) return;

    if (!deckId) {
      this.avisarDeckAusente(
        sessionId,
        'Escolha um grimório na sala de espera antes de ficar pronto.',
        'NO_DECK',
      );
      return;
    }

    const versao = (this.provisionamento.get(sessionId) ?? 0) + 1;
    this.provisionamento.set(sessionId, versao);

    try {
      // A URL vem da config (BACKEND_CORE_URL), nunca hardcoded: era isso que
      // fazia o game-server procurar a API numa porta onde ninguem escutava.
      // `ownerId` faz a API Core recusar o deck que nao e de quem pediu. E
      // indispensavel agora que o id chega numa INTENCAO do cliente e nao mais
      // dentro do seat token assinado: sem isso, qualquer jogador entraria com
      // o baralho de outro — e leria a lista inteira dele.
      const dono = this.state.players.get(sessionId)?.userId ?? '';
      const parametros = new URLSearchParams();
      if (dono) {
        parametros.set('ownerId', dono);
        // O formato da SALA, nao o do deck: e a sala que define o que esta
        // sendo jogado. A API Core recusa aqui, com a mesma mensagem de
        // `joinMatch` — sem isso, escolher um deck de 97 cartas na sala de
        // espera dava certo e a partida so quebrava depois, com todo mundo
        // ja sentado.
        parametros.set('gameType', this.state.gameType || 'COMMANDER');
      }
      const query = parametros.toString();
      const res = await fetch(
        `${config.BACKEND_CORE_URL}/api/v1/internal/decks/${deckId}${query ? `?${query}` : ''}`,
        {
          // A rota interna passou a exigir segredo compartilhado: sem ele, ela
          // era um endpoint publico que entregava o decklist de qualquer id.
          headers: config.INTERNAL_API_TOKEN
            ? { 'X-Internal-Token': config.INTERNAL_API_TOKEN }
            : {},
        },
      );

      if (!res.ok) {
        // A API Core devolve a razao no corpo ("exige exatamente 100 cartas",
        // "possui cartas banidas"). Descartar isso e trocar uma instrucao do
        // que fazer por um "nao deu certo" — que foi a experiencia de quem
        // tentava entrar com um deck irregular.
        const detalhe = await res
          .json()
          .then((corpo: unknown) => (corpo as { message?: string })?.message)
          .catch(() => undefined);
        this.avisarDeckAusente(
          sessionId,
          detalhe || 'Seu grimório não pôde ser carregado. Escolha outro na sala de espera.',
        );
        return;
      }
      // `Response.json()` devolve `unknown`: sem a asserção, todo acesso abaixo
      // é erro de tipo. O formato vem de DeckCard (docs/modelo_de_dados.md §3.4).
      const deckReal = (await res.json()) as DeckPayload;

      /**
       * SO A ULTIMA ESCOLHA VALE, E SO SE A PESSOA AINDA ESTA NA MESA.
       *
       * A limpeza do deck anterior acontecia ANTES do `await`: duas escolhas
       * seguidas limpavam as duas e depois empilhavam as duas respostas — 159
       * cartas no grimorio. E a resposta que chegava depois de o jogador sair
       * criava 99 cartas de um dono que nao existe mais.
       */
      if (this.provisionamento.get(sessionId) !== versao || !this.state.players.has(sessionId)) {
        return;
      }
      // Uma segunda escolha substitui a primeira; sem isto os dois decks se
      // somavam dentro das mesmas listas de zona.
      this.limparCartasDe(sessionId);

      const criar = (zone: Zone, dbCard: DeckCardPayload): Card => {
        const c = new Card();
        c.id = randomUUID();
        c.ownerId = sessionId;
        c.controllerId = sessionId;
        c.zone = zone;
        c.scryfallId = dbCard.scryfallId; // Agora salva o ID real para o Frontend saber o que renderizar
        this.state.cards.set(c.id, c);
        return c;
      };

      const deckCards: string[] = [];

      const reserva = this.state.zoneOrder.get(zoneOrderKey(sessionId, 'SIDEBOARD'))?.items;

      // Popula por boardType. Antes o `else` mandava TUDO que nao fosse
      // COMMANDER para o grimorio — inclusive SIDEBOARD e MAYBEBOARD. Quem
      // tivesse reserva cadastrada jogava com um grimorio maior que o deck.
      // Teto por linha: o backend limita a 99, mas um deck salvo antes do
      // limite com "2000000000 Forest" travava o processo inteiro do jogo
      // criando cartas neste laco.
      for (const card of deckReal.cards) {
        for (let i = 0; i < Math.min(card.quantity, 99); i++) {
          switch (card.boardType) {
            case 'COMMANDER':
            case 'SIGNATURE_SPELL': {
              // Marcado aqui, e so aqui: o comandante passa a partida inteira
              // fora da zona de comando, entao a zona nao serve para identifica-lo.
              const c = criar('COMMAND', card);
              c.isCommander = true;
              comando.push(c.id);
              break;
            }
            case 'SIDEBOARD':
              reserva?.push(criar('SIDEBOARD', card).id);
              break;
            case 'MAYBEBOARD':
              // Lista de considerACAO do deckbuilder: nao entra na mesa.
              break;
            default:
              deckCards.push(criar('LIBRARY', card).id);
          }
        }
      }

      // Embaralhar as cartas do grimório
      const ids = embaralhar(deckCards);
      for (const id of ids) {
        grimorio.push(id);
      }

      // A mao inicial NAO e comprada aqui. Com a sala de espera, quem entra
      // primeiro ficaria com 7 cartas na mesa enquanto os outros ainda estao
      // chegando — e o modal de mulligan abriria antes de a partida existir.
      // INTENT_START_MATCH compra para todo mundo ao mesmo tempo.
      //
      // Se a partida JA estiver rodando (jogador entrou no meio), compra agora.
      if (this.state.phase === 'PLAYING') {
        for (let i = 0; i < 7; i += 1) {
          const id = grimorio.pop();
          if (!id) break;
          const c = this.state.cards.get(id);
          if (c) c.zone = 'HAND';
          mao.push(id);
        }
      }

      const player = this.state.players.get(sessionId);
      if (player) {
        player.handCount = mao.length;
        player.libraryCount = grimorio.length;
        player.deckName = deckReal.name ?? '';
        // Trocar de deck invalida uma prontidao ja declarada: o jogador
        // confirmou com OUTRO grimorio na mesa.
        player.ready = false;
      }

      this.clients
        .find((c) => c.sessionId === sessionId)
        ?.send('deckReady', {
          deckId,
          name: deckReal.name ?? '',
          cards: grimorio.length + comando.length,
        });

      // RECONCILIAR TUDO AQUI: Garante que as cartas recém criadas e
      // assinaladas para a mão (HAND) / comando (COMMAND) recebam a view
      // correta e sejam visíveis para o dono!
      reconciliarTudo(this.clients, this.state);
    } catch (e) {
      console.error(`[${this.roomId}] Falha ao provisionar deck ${deckId}:`, e);
      this.avisarDeckAusente(
        sessionId,
        'Seu grimório não pôde ser carregado. Confirme que ele é seu e tente escolher de novo na sala de espera.',
      );
    }
  }

  /**
   * Conta ao JOGADOR que o deck dele nao entrou.
   *
   * Esta falha era registrada so no `console.error` do servidor. O efeito na
   * tela: o jogador entra, o anfitriao inicia a partida, e a mesa dele nasce
   * sem grimorio, sem comandante e sem mao — sobra assistir os outros jogarem.
   * Sem mensagem nenhuma, o diagnostico obvio para ele e "o jogo esta
   * quebrado", e nao "meu deck nao carregou".
   *
   * A causa mais comum em producao e o `INTERNAL_API_TOKEN` divergente entre
   * game-server e backend-core (DOC-055 §2): a rota interna devolve 401 e o
   * deck volta vazio, em silencio.
   */
  private avisarDeckAusente(
    sessionId: string,
    message: string,
    code: 'DECK_UNAVAILABLE' | 'NO_DECK' = 'DECK_UNAVAILABLE',
  ): void {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    client?.send('deckError', { code, message });
    // O aviso vai SO para quem perdeu o deck. Antes ele virava log publico: a
    // mesa inteira lia "o deck de fulano nao carregou" a cada tentativa, e o
    // log da partida virava o diario de erros de um jogador so.
  }
}
