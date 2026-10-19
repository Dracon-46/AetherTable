import { randomUUID } from 'node:crypto';
import type { AuthContext, Client, RoomException } from '@colyseus/core';
import { Protocol, Room } from '@colyseus/core';
import {
  REALTIME_LIMITS,
  ZONES,
  acharFormato,
  cartasParaDevolverNoMulligan,
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
import { revoga } from '../schema/visibility';
// Valor, nao so tipo: `OpcoesDeCriacao` valida as opcoes cruas do navegador.
import { z } from 'zod';
import {
  RateLimiter,
  REGISTRY,
  aplicarTopoRevelado,
  barreiraDoRemetente,
  haAssentoLivre,
  verificarAutorizacao,
  verificarFimDePartida,
  vidaInicialDaMesa,
  type IntentContext,
  type IntentHandler,
} from '../intents/registry';
import { embaralhar } from '../services/rng';
import { ordem } from '../services/mesa';
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
import { RecusaDeEntrada, emitirPasseDeVoz, validarPasse, type SeatTokenClaims } from './passes';

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

/**
 * ─── AS MENSAGENS SOCIAIS TÊM COTA PRÓPRIA ──────────────────────────────────
 *
 * Chat, ping, pedido para ver a mão e votação não mudam a mesa: cada uma vira
 * um `broadcast`, uma linha de log ou uma notificação NA TELA DE OUTRA PESSOA.
 * Dentro do limite geral (30/s) elas passavam inteiras — trinta mensagens de
 * chat por segundo, ou trinta pedidos de "deixa eu ver sua mão" seguidos na
 * tela do alvo. Dez a cada dez segundos cobre qualquer conversa de mesa.
 */
const INTENCOES_SOCIAIS = new Set<string>([
  'INTENT_CHAT',
  'INTENT_PING',
  'INTENT_REQUEST_VIEW',
  'INTENT_VOTE_KICK',
]);
const MAX_SOCIAIS_POR_JANELA = 10;
const SOCIAL_JANELA_MS = 10_000;

/**
 * ─── QUEM SÓ MANDA LIXO É DESCONECTADO ──────────────────────────────────────
 *
 * Os limitadores descartam o excesso, mas cada descarte ainda custa o parse do
 * pacote — e respondia um `warning`, o que fazia o servidor devolver uma
 * mensagem para cada mensagem do atacante. Agora o aviso sai uma vez por
 * janela, e quem acumula `MAX_DESCARTES_POR_JANELA` descartes numa janela é
 * desconectado (4002, o código de "fechado por erro" do Colyseus). Um humano
 * segurando uma tecla gera dezenas por janela, nunca centenas.
 */
const MAX_DESCARTES_POR_JANELA = 300;
const DESCARTES_JANELA_MS = 10_000;

/** Uma busca de grimório na API por sessão a cada tanto — ver `pedirDeck`. */
const INTERVALO_DE_DECK_MS = 2_000;

/**
 * Quanto a sala espera a API Core antes de desistir de uma chamada. Sem teto,
 * uma API pendurada segurava o `provisionarDeck` (e, no `onDispose`, o
 * encerramento da sala) pelo tempo que o sistema operacional quisesse.
 */
const TEMPO_DA_API_MS = 8_000;

/**
 * Reserva de vaga do matchmaker, em segundos (o padrão do Colyseus é 15).
 *
 * É o intervalo entre a resposta do `POST /matchmake` e o WebSocket conectar —
 * no cliente honesto, o tempo de um round-trip. Quinze segundos eram o tempo
 * que uma reserva sem conexão segurava uma das vagas de `maxClients`.
 */
const TEMPO_DE_RESERVA_S = 8;

/**
 * Teto de cartas de UM grimório provisionado (comando + grimório + reserva).
 *
 * A API limita a 99 cópias por LINHA, não o número de linhas: um deck salvo com
 * cem linhas de 99 virava dez mil cartas na mesa — muito além do que cabe no
 * buffer de encode da sala (ver `index.ts`). 250 está bem acima de qualquer
 * formato jogável (Commander é 100), e oito assentos no teto somam por volta de
 * 450 KB de estado (~225 bytes por carta, medidos lá) — abaixo dos 512 KB.
 */
const MAX_CARTAS_POR_GRIMORIO = 250;

/** Uma carta do deck, como vem de `GET /api/v1/internal/decks/:id`. */
interface DeckCardPayload {
  scryfallId: string;
  quantity: number;
  boardType: string;
}

/**
 * O que o histórico de partidas guarda de cada jogador — a "foto" tirada quando
 * ele sai da mesa, quando a partida termina e quando a sala fecha. Quem sai
 * antes do fim leva o próprio estado embora (`players.delete`), e por isso a
 * foto é tirada ANTES, e não reconstruída no `onDispose`.
 */
interface ParticipacaoNaPartida {
  userId: string;
  assento: number;
  deckId?: string;
  nomeDoDeck?: string;
  comandanteId?: string;
  vidaFinal: number;
  motivoDaEliminacao?: string;
  saiuAntes: boolean;
}

/** Resposta de `GET /api/v1/internal/decks/:id`. */
interface DeckPayload {
  id: string;
  name: string;
  cards: DeckCardPayload[];
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
   * Reação é a mesma família (um gesto que só gera broadcast), mas com cota
   * própria: dividir a dos sorteios faria um "👍" impedir a próxima rolagem.
   */
  private readonly limitadorDeReacao = new RateLimiter(
    REALTIME_LIMITS.MAX_REACOES_POR_JANELA,
    REALTIME_LIMITS.REACAO_JANELA_MS,
  );
  /** Chat, ping, pedido de vista e votação — ver `INTENCOES_SOCIAIS`. */
  private readonly limitadorSocial = new RateLimiter(MAX_SOCIAIS_POR_JANELA, SOCIAL_JANELA_MS);
  /** Uma busca de grimório por sessão a cada `INTERVALO_DE_DECK_MS` — ver `pedirDeck`. */
  private readonly limitadorDeDeck = new RateLimiter(1, INTERVALO_DE_DECK_MS);
  /** Conta os DESCARTES de cada sessão — ver `MAX_DESCARTES_POR_JANELA`. */
  private readonly limitadorDeDescartes = new RateLimiter(
    MAX_DESCARTES_POR_JANELA,
    DESCARTES_JANELA_MS,
  );
  /** Um `warning` de excesso por sessão e por janela, e não um por descarte. */
  private readonly limitadorDeAvisos = new RateLimiter(1, DESCARTES_JANELA_MS);
  /** A escolha de grimório que chegou dentro da janela e espera a próxima. */
  private readonly deckAdiado = new Map<string, string>();
  /**
   * Sessões contadas em `ws_connections_active`. A métrica só sobe para quem
   * foi ADMITIDO, e só desce para quem subiu: a entrada recusada no `onJoin`
   * passa pelo `onLeave` (o Colyseus desfaz a entrada assim), e descontar ali
   * levava o gauge a negativo.
   */
  private readonly conexoesContadas = new Set<string>();
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
  /** Fechamento agendado da janela de mulligan — ver `agendarFimDoMulligan`. */
  private fimDoMulligan: { clear(): void } | null = null;
  private fimDoMulliganAgendado = 0;
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
  /** Uma foto por CONTA (não por sessão: quem reconecta é a mesma pessoa). */
  private readonly participacoes = new Map<string, ParticipacaoNaPartida>();
  /** De qual deck saiu o grimório de cada sessão — o histórico abre o deck por ele. */
  private readonly deckIdPorSessao = new Map<string, string>();
  /** Conta de quem estava na vez quando a partida começou. */
  private quemComecou = '';
  /**
   * Conta de quem venceu. O fim de partida era só um aviso (`matchEnded`) para
   * a tela — anunciado em três lugares — e ninguém guardava o resultado.
   * Agora os três passam por `transmitir`, que o registra.
   */
  private vencedorUserId = '';
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
    // resto. A correcao FORTE (config assinada) chega em `admitir`.
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
    this.setSeatReservationTime(TEMPO_DE_RESERVA_S);

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

  /**
   * ─── O PRAZO DO MULLIGAN ─────────────────────────────────────────────────
   *
   * Mesmo desenho da votação: o estado diz QUANDO vence (`mulliganExpiraEm`)
   * e quem fecha é o servidor, no relógio da sala — não o cliente, que pode
   * estar com a aba em segundo plano, desconectado ou simplesmente mentindo.
   * Chamado depois de cada intenção: é quando o prazo nasce (START_MATCH),
   * morre (RESET_MATCH) ou deixa de importar (todo mundo decidiu).
   */
  private agendarFimDoMulligan(): void {
    const { mulliganExpiraEm, phase } = this.state;
    if (!mulliganExpiraEm) return;
    // Todo mundo decidiu antes do prazo: o relógio some da tela de todos.
    const faltaAlguem = Array.from(this.state.players.values()).some((p) => !p.keptHand);
    if (phase !== 'PLAYING' || !faltaAlguem) {
      this.state.mulliganExpiraEm = 0;
      return;
    }
    if (this.fimDoMulliganAgendado === mulliganExpiraEm) return;
    this.fimDoMulligan?.clear();
    this.fimDoMulliganAgendado = mulliganExpiraEm;
    this.fimDoMulligan = this.clock.setTimeout(
      () => {
        this.fimDoMulligan = null;
        this.fimDoMulliganAgendado = 0;
        this.encerrarMulliganPorTempo();
      },
      Math.max(0, mulliganExpiraEm - Date.now()) + 50,
    );
  }

  /**
   * Quem não decidiu fica com a mão que tem. As cartas que a regra da mesa
   * ainda cobrava ao fundo (London, ou o segundo mulligan em diante no
   * Commander) vão ao fundo AO ACASO — pelo CSPRNG, como todo sorteio da mesa
   * (RN06) — e o log diz quantas foram.
   */
  private encerrarMulliganPorTempo(): void {
    const { mulliganExpiraEm } = this.state;
    if (!mulliganExpiraEm || mulliganExpiraEm > Date.now()) return;
    this.state.mulliganExpiraEm = 0;
    if (this.state.phase !== 'PLAYING') return;

    this.state.players.forEach((p) => {
      if (p.keptHand) return;
      // O contexto é o do PRÓPRIO jogador: a carta sai da mão dele para o
      // grimório dele pela mesma intenção de quando ele faz isso no modal.
      // Desconectado, o cliente é um dublê mudo.
      const cliente =
        this.clients.find((c) => c.sessionId === p.id) ??
        ({ sessionId: p.id, send: () => {} } as unknown as Client);
      const contexto = this.montarContexto(cliente);
      const devolver = cartasParaDevolverNoMulligan(this.state.tipoDeMulligan, p.mulliganCount);
      const mao = [...(ordem(this.state, p.id, 'HAND') ?? [])];
      const aoFundo = embaralhar(mao).slice(0, Math.min(devolver, mao.length));
      for (const id of aoFundo) {
        REGISTRY.INTENT_CHANGE_ZONE.executa(contexto, {
          entityId: id,
          targetZone: 'LIBRARY',
          index: 0,
        } as never);
      }
      p.keptHand = true;
      aplicarTopoRevelado(contexto, p.id);
      this.publicarLog(
        logSistema(
          p.id,
          aoFundo.length
            ? `O tempo do mulligan acabou: ${p.name} ficou com a mão, e ${aoFundo.length} carta(s) foram ao fundo ao acaso`
            : `O tempo do mulligan acabou: ${p.name} ficou com a mão`,
        ),
      );
    });
  }

  private cancelarDescarte(): void {
    this.descarteDaSalaVazia?.clear();
    this.descarteDaSalaVazia = null;
  }

  /**
   * Grava uma configuracao JA NORMALIZADA no estado.
   *
   * Um caminho so para os dois momentos em que a config chega — o `onCreate`,
   * com o que o navegador mandou, e a admissao do criador, com o que a API
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
     * acontece no MATCHMAKING, antes de `admitir`. Com `maxClients` igual aos
     * assentos, o espectador seria recusado antes de o servidor sequer abrir o
     * passe dele e descobrir que ele nao queria assento nenhum.
     *
     * Entao `maxClients` passa a ser assentos + plateia, e A LOTACAO DE
     * JOGADORES VIRA RESPONSABILIDADE NOSSA — ela e checada em `admitir`, que
     * lanca `ROOM_FULL`. Isto e uma transferencia real de responsabilidade do
     * framework para este arquivo: se a checagem de `admitir` sumir numa
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
    // `admitir` ver o assento novo.
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
   * ─── A ENTRADA É DECIDIDA ANTES DE A SALA EXISTIR ─────────────────────────
   *
   * No Colyseus 0.16, `POST /matchmake/joinOrCreate` roda o `onCreate` e
   * RESERVA a vaga antes do `onAuth` de instância — que só roda quando o
   * WebSocket conecta. Com a autenticação só ali, qualquer um sem passe abria
   * salas à vontade, e dezoito POSTs enchiam o `maxClients` de qualquer mesa
   * com reservas que nunca conectavam.
   *
   * O `onAuth` ESTÁTICO roda em `callOnAuth`, antes de procurar, criar ou
   * reservar. Ele valida o passe (`validarPasse`: audiência da mesa, HS256,
   * `sub`, `jti` e `roomId` obrigatórios) e exige que o `roomCode` pedido seja
   * o da sala para a qual o passe foi emitido. O filtro do matchmaker
   * (`filterBy(['roomCode'])`) usa esse mesmo campo: um passe da sala A não
   * cria, não encontra e não reserva vaga na sala B.
   *
   * Quando o estático devolve dados, o Colyseus os entrega como `client.auth` e
   * PULA o `onAuth` de instância (`Room._onJoin`) — por isso ele não existe
   * mais aqui. O que depende do estado da sala (passe já usado, conta
   * bloqueada, assento duplicado, lotação) ficou em `admitir`, no `onJoin`.
   */
  // `async` sem `await`: o matchmaker faz `await` e todo `throw` daqui precisa
  // chegar como promessa rejeitada, não como exceção síncrona.
  // eslint-disable-next-line @typescript-eslint/require-await -- contrato de promessa do Colyseus
  static override async onAuth(
    _token: string,
    options: unknown,
    _context: AuthContext,
  ): Promise<SeatTokenClaims> {
    const { seatToken, roomCode } = (options ?? {}) as { seatToken?: unknown; roomCode?: unknown };
    const claims = validarPasse(seatToken);
    if (roomCode !== claims.roomId) throw new RecusaDeEntrada('INVALID_TOKEN');
    return claims;
  }

  /**
   * Decide, com o estado da sala, se esta conexão entra.
   *
   * Lança `RecusaDeEntrada`. Lançar no `onJoin` faz o Colyseus desfazer a
   * entrada (`_onJoin` chama `_onLeave` e apaga a reserva) e mandar a mensagem
   * ao cliente como erro de conexão — a mesma forma que o `onAuth` de instância
   * produzia, com o código (`ROOM_FULL`, ...) na mensagem.
   *
   * Síncrono de ponta a ponta: sem `await` entre checar e consumir, duas
   * entradas não disputam o mesmo passe nem a mesma vaga.
   */
  private admitir(auth: SeatTokenClaims): void {
    // O estático já casou o passe com o `roomCode` pedido, e a sala foi achada
    // (ou criada) por esse código. A repetição aqui é a defesa que sobra se
    // alguém um dia chamar `_reserveSeat` por outro caminho.
    if (!auth?.sub || !auth.jti || auth.roomId !== this.state.roomCode) {
      throw new RecusaDeEntrada('INVALID_TOKEN');
    }

    if (this.jtisUsados.has(auth.jti)) throw new RecusaDeEntrada('TOKEN_ALREADY_USED');

    // Removido da mesa (pelo anfitrião ou por votação) não volta — nem como
    // espectador, que veria a mesa de quem acabou de tirá-lo dela.
    if (this.contasBanidas.has(auth.sub)) throw new RecusaDeEntrada('PLAYER_BLOCKED');

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
     * aqui e o unico ponto possivel: o Colyseus nao entrega o resultado da
     * autenticacao ao `onCreate`, que roda antes.
     *
     * A GUARDA E `players.size === 0`, e nao "e o assento 0".
     *
     * O criador e sempre o primeiro a autenticar, entao a sala vazia identifica
     * exatamente ele. Usar o assento seria pior: `removerJogador` reatribui
     * assentos a cada saida, entao o assento 0 e um papel que muda de dono
     * durante a partida — e quem herdasse o papel reescreveria a mesa inteira
     * apresentando um passe emitido para outra configuracao.
     */
    if (auth.cfg && this.state.players.size === 0) {
      this.aplicarConfig(normalizarConfigDeSala(auth.cfg));
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
    if (!auth.spectator) {
      const mesmo = Array.from(this.state.players.values()).find((p) => p.userId === auth.sub);
      if (mesmo?.connected) throw new RecusaDeEntrada('ALREADY_SEATED');
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
    if (!auth.spectator && !haAssentoLivre(this.state)) {
      throw new RecusaDeEntrada('ROOM_FULL');
    }
    // A plateia tem teto próprio. `maxClients` é assentos + plateia somados, e
    // com a mesa ainda vazia de jogadores a sala aceitava dezoito espectadores
    // — as vagas de assento viravam lugar na arquibancada.
    if (auth.spectator && this.state.espectadores.size >= REALTIME_LIMITS.MAX_ESPECTADORES) {
      throw new RecusaDeEntrada('ROOM_FULL');
    }

    // O passe só é CONSUMIDO aqui, depois de a vaga ser confirmada. Antes ele
    // era marcado logo após a assinatura: o quinto jogador recebia "mesa
    // cheia", e quando uma vaga abria o mesmo link respondia "token já usado"
    // — que parecia defeito, e não lotação. Não há `await` entre a checagem e
    // a marcação, então duas entradas não disputam o mesmo passe.
    this.jtisUsados.add(auth.jti);
  }

  override onJoin(client: Client, _options: JoinOptions, auth: SeatTokenClaims): void {
    this.admitir(auth);
    // `ws_connections_active` e `ws_reconnections_total` eram expostas em
    // /metrics e NUNCA atualizadas: o painel mostrava zero jogadores conectados
    // com a mesa cheia. Cada cliente que entra (jogador ou plateia) conta um;
    // cada `onLeave` desconta — e só quem passou por `admitir` conta.
    this.contarConexao(client.sessionId);

    if (auth.spectator) this.entrarComoEspectador(client, auth);
    else this.entrarComoJogador(client, auth);

    this.enviarPasseDeVoz(client, auth.sub, auth.spectator === true);
  }

  private entrarComoJogador(client: Client, auth: SeatTokenClaims): void {
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

  /**
   * Manda ao cliente o passe de voz desta sala — ver `emitirPasseDeVoz`.
   *
   * Chamado depois de `admitir` e depois de cada reconexão. Antes do JOIN do
   * Colyseus o `send` fica na fila do cliente e sai logo depois do estado
   * inicial: o frontend precisa registrar `onMessage('passe-de-voz')` no mesmo
   * tick em que o `joinOrCreate`/`reconnect` resolve.
   */
  private enviarPasseDeVoz(client: Client, sub: string, spectator: boolean): void {
    client.send('passe-de-voz', {
      token: emitirPasseDeVoz({ sub, roomId: this.state.roomCode, spectator }),
    });
  }

  private contarConexao(sessionId: string): void {
    if (this.conexoesContadas.has(sessionId)) return;
    this.conexoesContadas.add(sessionId);
    conexoesAtivas.inc();
  }

  private descontarConexao(sessionId: string): void {
    if (this.conexoesContadas.delete(sessionId)) conexoesAtivas.dec();
  }

  /** Quem foi embora de vez não ocupa mais memória em limitador nenhum. */
  private esquecerLimites(sessionId: string): void {
    for (const limitador of [
      this.rateLimiter,
      this.limitadorDeSorteio,
      this.limitadorDeReacao,
      this.limitadorSocial,
      this.limitadorDeDeck,
      this.limitadorDeDescartes,
      this.limitadorDeAvisos,
    ]) {
      limitador.esquecer(sessionId);
    }
    this.deckAdiado.delete(sessionId);
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
    this.descontarConexao(client.sessionId);
    /**
     * Espectador sai NA HORA, sem janela de reconexao.
     *
     * A janela de `allowReconnection` existe para guardar o ASSENTO e as cartas
     * de quem caiu. Espectador nao tem nem um nem outro: segurar a saida dele
     * so faria a lista da mesa mostrar plateia que ja foi embora, e ainda
     * ocuparia uma das dez vagas de `MAX_ESPECTADORES`.
     */
    if (this.state.espectadores.has(client.sessionId)) {
      const espectador = this.state.espectadores.get(client.sessionId);
      this.state.espectadores.delete(client.sessionId);
      this.esquecerLimites(client.sessionId);
      this.broadcast('spectatorLeft', {
        spectatorId: client.sessionId,
        name: espectador?.name ?? '',
      });
      this.publicarMetadados();
      this.agendarDescarteSeVazia();
      return;
    }

    /**
     * ─── SEM ASSENTO, NÃO HÁ O QUE GUARDAR ──────────────────────────────────
     *
     * Chegam aqui a entrada recusada por `admitir` (o Colyseus desfaz a entrada
     * passando pelo `onLeave`) e a aba antiga que reconectou depois de perder o
     * assento. As duas caíam no `allowReconnection` de dez minutos — e a aba
     * sem assento, ao reconectar, era derrubada e voltava a esperar, em ciclo,
     * cada volta segurando uma reserva de vaga.
     */
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      this.esquecerLimites(client.sessionId);
      return;
    }

    player.connected = false;
    player.disconnectedAt = Date.now();

    // Libera qualquer lock de arraste que o jogador estivesse segurando: sem
    // isso a carta fica travada para todos ate o TTL expirar.
    this.state.cards.forEach((card) => {
      if (card.lockedBy === client.sessionId) card.lockedBy = '';
    });

    // Saida consentida (o jogador clicou em sair) ou expulsao pelo anfitriao:
    // nos dois casos o assento vai embora agora. Guardar a vaga do expulso
    // seria desfazer o chute na pratica — a sala continuaria cheia.
    if (consented || this.expulsos.has(client.sessionId)) {
      this.expulsos.delete(client.sessionId);
      this.removerJogador(client.sessionId);
      return;
    }

    this.broadcast('playerDisconnected', { playerId: client.sessionId });

    try {
      // O que volta é o cliente NOVO. É ele que ainda está no JOIN do
      // Colyseus e enfileira o que receber; o antigo (`client`) já aponta para
      // o socket novo e mandaria por fora da fila, antes do JOIN — e o
      // navegador descartaria a mensagem por não ter quem a ouça.
      const novo = await this.allowReconnection(client, REALTIME_LIMITS.RECONNECTION_WINDOW_S);
      // A mesma conta pode ter voltado por um passe novo enquanto esta aba
      // estava fora (`admitir` libera o assento antigo). A aba antiga que
      // reconecta depois disso não tem mais assento: ficaria na sala como um
      // cliente sem jogador, vendo a mesa sem ser plateia nem mesa.
      if (!this.state.players.has(client.sessionId)) {
        reconexoes.inc({ result: 'sem-assento' });
        client.leave(4001);
        return;
      }
      this.contarConexao(client.sessionId);
      reconexoes.inc({ result: 'ok' });
      player.connected = true;
      player.disconnectedAt = 0;
      // A view nao sobrevive a reconexao: reconstruir e obrigatorio.
      reconciliarClient(client, this.state);
      this.broadcast('playerReconnected', { playerId: client.sessionId });
      this.enviarPasseDeVoz(novo, player.userId, false);
    } catch {
      reconexoes.inc({ result: 'expirou' });
      this.removerJogador(client.sessionId);
    }
  }

  /**
   * ─── O RESUMO DA PARTIDA SUMIA NO DEPLOY ──────────────────────────────────
   *
   * O comentário antigo dizia que `onDispose` não espera promessa. Espera: o
   * `Room._dispose` do Colyseus faz `await` do que ele devolve, e só depois
   * emite o `disconnect` que o desligamento gracioso aguarda. Com o `void`, o
   * deploy derrubava o processo com o `fetch` do resumo em voo, e a partida
   * sumia do histórico de todo mundo. A espera é limitada por `TEMPO_DA_API_MS`.
   */
  override onDispose(): Promise<void> {
    salasAtivas.dec();
    return this.registrarResumoDaPartida();
  }

  /**
   * ─── UMA EXCEÇÃO NUM TIMER DERRUBAVA O PROCESSO ───────────────────────────
   *
   * Os callbacks de `clock.setTimeout` (descarte da sala vazia, fim da votação,
   * prazo do mulligan) rodam fora de qualquer `try`: uma exceção ali virava
   * `uncaughtException` e levava junto TODAS as mesas do nó. Definir este
   * método faz o Colyseus embrulhar timers, mensagens e o ciclo de vida da
   * sala (`Room` registra os embrulhos no construtor), e a falha vira log.
   *
   * A recusa de entrada passa por aqui também — `admitir` lança no `onJoin` —,
   * mas ela não é falha: é a sala dizendo "não", e o Colyseus já a repassa ao
   * cliente.
   */
  override onUncaughtException(erro: RoomException<this>, metodo: string): void {
    if (erro.cause instanceof RecusaDeEntrada) return;
    console.error(`[${this.roomId}] exceção não tratada em ${metodo}:`, erro.cause ?? erro);
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

  /**
   * Toda transmissão de fim de partida passa por aqui: é onde o vencedor fica
   * registrado e a mesa inteira é fotografada no instante do fim.
   */
  private transmitir(evento: string, payload?: unknown): void {
    if (evento === 'matchEnded') {
      const id = (payload as { winnerId?: string } | undefined)?.winnerId;
      const vencedor = id ? this.state.players.get(id) : undefined;
      if (vencedor?.userId) this.vencedorUserId = vencedor.userId;
      this.state.players.forEach((p) => this.fotografar(p, false));
    }
    this.broadcast(evento, payload);
  }

  /** A foto de um jogador para o histórico. Só vale depois que a partida começou. */
  private fotografar(p: Player, saiuAntes: boolean): void {
    if (!p.userId || !this.inicioDaPartida) return;
    let comandanteId: string | undefined;
    this.state.cards.forEach((c) => {
      if (!comandanteId && c.ownerId === p.id && c.isCommander && c.scryfallId) {
        comandanteId = c.scryfallId;
      }
    });
    const anterior = this.participacoes.get(p.userId);
    this.participacoes.set(p.userId, {
      userId: p.userId,
      assento: p.seat,
      deckId: this.deckIdPorSessao.get(p.id) ?? anterior?.deckId,
      // Os cortes casam com os limites do DTO da API: um campo comprido demais
      // faria o resumo INTEIRO ser recusado, e a partida sumiria do histórico.
      nomeDoDeck: p.deckName.slice(0, 80) || anterior?.nomeDoDeck,
      comandanteId: comandanteId ?? anterior?.comandanteId,
      vidaFinal: p.life,
      motivoDaEliminacao: p.eliminated ? p.eliminationReason || undefined : undefined,
      saiuAntes,
    });
  }

  private async registrarResumoDaPartida(): Promise<void> {
    if (!this.state.turnoIniciadoEm) return;
    if (this.contasQueJogaram.size === 0) return;
    // Quem continua na mesa até a sala fechar é fotografado agora.
    this.state.players.forEach((p) => this.fotografar(p, false));

    // Do START_MATCH, nao da criacao da sala: a duracao incluia o lobby e a
    // espera de descarte da sala vazia.
    const inicio = this.inicioDaPartida || this.state.startedAt;
    const duracao = Math.max(0, Math.round((Date.now() - inicio) / 1000));

    try {
      const res = await fetch(`${config.BACKEND_CORE_URL}/api/v1/internal/matches/summary`, {
        // O `onDispose` espera esta chamada: sem teto, uma API pendurada
        // segurava o fechamento da sala — e o desligamento do processo.
        signal: AbortSignal.timeout(TEMPO_DA_API_MS),
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
          formato: this.state.gameType.slice(0, 32),
          turnos: this.state.turn,
          detalhes: Array.from(this.participacoes.values())
            .slice(0, REALTIME_LIMITS.MAX_PLAYERS)
            .map((p) => ({
              ...p,
              venceu: p.userId === this.vencedorUserId,
              comecou: p.userId === this.quemComecou,
            })),
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
    const entradas = Object.entries(REGISTRY) as [string, IntentHandler<z.ZodTypeAny>][];

    for (const [tipo, handler] of entradas) {
      this.onMessage(tipo, (client, payload: unknown) => {
        // Rate limit antes de qualquer trabalho: 30 intencoes/s (NFR-04).
        if (!this.rateLimiter.permitir(client.sessionId)) {
          this.descartar(client, 'rate_limit', {
            code: 'RATE_LIMITED',
            message: 'Muitas ações por segundo. Algumas foram descartadas.',
          });
          return;
        }

        // Sorteios tem janela propria — ver `limitadorDeSorteio`.
        if (INTENCOES_DE_SORTEIO.has(tipo) && !this.limitadorDeSorteio.permitir(client.sessionId)) {
          this.descartar(client, 'too_many_rolls', {
            code: 'RATE_LIMITED',
            message: `Calma com os sorteios: até ${REALTIME_LIMITS.MAX_SORTEIOS_POR_JANELA} a cada ${Math.round(REALTIME_LIMITS.SORTEIO_JANELA_MS / 1000)} s.`,
          });
          return;
        }

        // Reação: freio próprio. Recusa calada — avisar a cada balão a mais
        // seria mais ruído que o próprio excesso.
        if (tipo === 'INTENT_REACTION' && !this.limitadorDeReacao.permitir(client.sessionId)) {
          this.descartar(client, 'too_many_reactions');
          return;
        }

        // Chat, ping, pedido de vista e votação — ver `INTENCOES_SOCIAIS`.
        if (INTENCOES_SOCIAIS.has(tipo) && !this.limitadorSocial.permitir(client.sessionId)) {
          this.descartar(client, 'too_many_social', {
            code: 'RATE_LIMITED',
            message: `Calma: até ${MAX_SOCIAIS_POR_JANELA} mensagens a cada ${SOCIAL_JANELA_MS / 1000} s.`,
          });
          return;
        }

        /**
         * ─── SÓ QUEM ESTÁ NA MESA MEXE NA MESA ─────────────────────────────
         *
         * `verificarAutorizacao` NAO cobre isto, e e importante entender por
         * que: ela devolve `null` na hora para `QUALQUER_JOGADOR`, sem checar
         * se o remetente e mesmo um jogador — o nome da regra sempre foi uma
         * promessa que ninguem verificava.
         *
         * A barreira fica AQUI, e nao dentro de cada handler, pelo mesmo motivo
         * de `exigirAnfitriao` existir: a proxima intencao nasce protegida em
         * vez de nascer aberta. E ela exige ASSENTO, e nao so "não ser
         * plateia": um cliente que perdeu o assento (a aba antiga de quem
         * voltou por um passe novo, no intervalo até ser derrubada) não era
         * nem um nem outro, e passava.
         *
         * A plateia passa só no chat (`INTENCOES_DE_ESPECTADOR`): quem assiste
         * comenta a partida, e o chat nao muta estado nenhum.
         */
        const barreira = barreiraDoRemetente(this.state, client.sessionId, tipo);
        if (barreira === 'SPECTATOR') {
          intentsRejeitadas.inc({ reason: 'spectator' });
          client.send('error', {
            code: 'SPECTATOR',
            message: 'Você está assistindo a esta mesa. Só quem tem assento pode agir nela.',
            intent: tipo,
          });
          return;
        }
        if (barreira === 'SEM_ASSENTO') {
          intentsRejeitadas.inc({ reason: 'no_seat' });
          client.send('error', {
            code: 'NOT_AUTHORIZED',
            message: 'Você não tem assento nesta mesa.',
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
          this.agendarFimDoMulligan();
          if (this.state.phase !== faseAntes) {
            this.publicarMetadados();
            if (this.state.phase === 'PLAYING') {
              if (!this.inicioDaPartida) this.inicioDaPartida = Date.now();
              this.registrarParticipantes();
              if (!this.quemComecou) {
                this.quemComecou = this.state.players.get(this.state.activePlayerId)?.userId ?? '';
              }
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
      broadcast: (event, payload) => this.transmitir(event, payload),
      log: (entrada) => this.publicarLog(entrada),
      desfazer: () => this.historico.desfazer(client.sessionId),
      invalidarDesfazer: () => this.historico.esquecerTodos(),
      expulsar: (sessionId) => this.expulsar(sessionId),
      aoMudarLotacao: () => this.publicarMetadados(),
    };
  }

  /**
   * Um pedido descartado por limite — ver `MAX_DESCARTES_POR_JANELA`.
   *
   * O `warning` sai no máximo uma vez por janela: responder cada descarte fazia
   * o servidor devolver uma mensagem para cada mensagem do flood. Quem passa do
   * teto de descartes é desconectado com código de erro, sem consentimento — o
   * assento fica guardado pela janela de reconexão, como numa queda comum.
   */
  private descartar(
    client: Client,
    motivo: string,
    aviso?: { code: string; message: string },
  ): void {
    intentsRejeitadas.inc({ reason: motivo });
    if (!this.limitadorDeDescartes.permitir(client.sessionId)) {
      client.leave(Protocol.WS_CLOSE_WITH_ERROR);
      return;
    }
    if (aviso && this.limitadorDeAvisos.permitir(client.sessionId)) client.send('warning', aviso);
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
    // `admitir`, entao ele voltava a sentar apesar do bloqueio da conta. Sai
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
      if (!this.rateLimiter.permitir(client.sessionId)) {
        this.descartar(client, 'rate_limit');
        return;
      }

      // Esta intencao NAO passa pelo dispatcher do REGISTRY (ela faz I/O), e
      // por isso a barreira de la nao a alcanca. Sem esta linha, quem assiste
      // escolheria um grimorio e o servidor tentaria provisiona-lo para um
      // sessionId que nao tem zona nenhuma.
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

      if (!this.podeEscolherDeck(client.sessionId)) {
        client.send('error', {
          code: 'NOT_AUTHORIZED',
          message: 'O grimório só pode ser escolhido antes de a partida começar.',
          intent: 'INTENT_SET_DECK',
        });
        return;
      }

      this.pedirDeck(client.sessionId, deckId);
    });
  }

  /**
   * Trocar de deck no meio da partida seria trocar de baralho com o jogo em
   * andamento. So na sala de espera — com UMA excecao: quem entrou com a
   * partida rodando e ainda nao tem carta nenhuma. "Entrar" pela lista publica
   * manda um passe sem deck, e a recusa deixava a pessoa sentada, sem
   * grimorio, assistindo a mesa para sempre.
   */
  private podeEscolherDeck(sessionId: string): boolean {
    if (!this.state.players.has(sessionId)) return false;
    if (this.state.phase === 'WAITING') return true;
    const semCartas = !Array.from(this.state.cards.values()).some(
      (c) => c.ownerId === sessionId && !c.isToken,
    );
    return this.state.phase === 'PLAYING' && semCartas;
  }

  /**
   * ─── UMA BUSCA DE GRIMÓRIO A CADA DOIS SEGUNDOS ───────────────────────────
   *
   * Cada `INTENT_SET_DECK` era um `fetch` à API Core, e o limite geral deixa
   * passar trinta intenções por segundo: um cliente sozinho fazia a sala
   * disparar trinta buscas por segundo contra a rota interna de decks, que
   * monta o decklist inteiro a cada chamada.
   *
   * Agora sai no máximo uma busca por `INTERVALO_DE_DECK_MS`, por sessão. A
   * escolha que chega dentro da janela não é descartada: fica guardada e sai
   * quando a janela abre — só a ÚLTIMA. Descartar quebraria o uso honesto:
   * percorrer o `<select>` do lobby com as setas manda uma escolha por tecla, e
   * a que vale é aquela em que a pessoa parou.
   */
  private pedirDeck(sessionId: string, deckId: string): void {
    if (this.limitadorDeDeck.permitir(sessionId)) {
      void this.provisionarDeck(sessionId, deckId);
      return;
    }
    const jaAgendado = this.deckAdiado.has(sessionId);
    this.deckAdiado.set(sessionId, deckId);
    if (jaAgendado) return;
    this.clock.setTimeout(() => {
      const adiado = this.deckAdiado.get(sessionId);
      this.deckAdiado.delete(sessionId);
      // A regra é conferida de novo: a partida pode ter começado na espera, e
      // provisionar agora apagaria as cartas de quem já está jogando.
      if (adiado && this.podeEscolherDeck(sessionId)) this.pedirDeck(sessionId, adiado);
    }, INTERVALO_DE_DECK_MS);
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
    // `admitir`, e a janela de reconexão dele ainda vence depois e chama isto
    // de novo — sem a guarda, a mesa anunciaria a saída duas vezes.
    if (!player) return;
    // A foto vem ANTES do `delete`: depois dele, a vida, o deck e o
    // comandante de quem saiu não existem mais em lugar nenhum.
    this.fotografar(player, this.state.phase === 'PLAYING');
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
    this.esquecerLimites(sessionId);
    this.historico.esquecer(sessionId);
    // Depois da foto, que ainda o lê: o histórico já levou o deck de quem saiu.
    this.deckIdPorSessao.delete(sessionId);

    for (const zone of ZONES) {
      this.state.zoneOrder.delete(zoneOrderKey(sessionId, zone));
    }
    this.state.cards.forEach((card, id) => {
      if (card.ownerId === sessionId) {
        this.state.cards.delete(id);
        return;
      }
      // Carta de OUTRO dono sob controle de quem saiu ficava apontando para um
      // jogador inexistente: ninguém podia movê-la e ela não era desenhada em
      // faixa nenhuma. O controle volta ao dono.
      if (card.controllerId === sessionId) card.controllerId = card.ownerId;
      if (card.lockedBy === sessionId) card.lockedBy = '';
      // As concessões a quem saiu não servem a mais ninguém — sessionId não se
      // repete — e só incham as strings que viajam em todo patch da carta.
      if (card.revealedTo !== 'ALL') card.revealedTo = revoga(card.revealedTo, sessionId);
      card.peekedBy = revoga(card.peekedBy, sessionId);
    });
    // Idem para "deixei fulano ver minha mão": a permissão de zona de cada
    // jogador ainda listava quem já foi embora.
    this.state.players.forEach((p) => {
      for (const [zona, lista] of Array.from(p.sharedZones.entries())) {
        const restante = revoga(lista, sessionId);
        if (restante === lista) continue;
        if (restante) p.sharedZones.set(zona, restante);
        else p.sharedZones.delete(zona);
      }
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
      broadcast: (event, payload) => this.transmitir(event, payload),
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
      this.transmitir('matchEnded', { winnerId: vencedor.id, winnerName: vencedor.name });
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

    /**
     * ─── SEM DONO, NÃO HÁ BUSCA ─────────────────────────────────────────────
     *
     * `ownerId` faz a API Core recusar o deck que nao e de quem pediu, e era
     * OPCIONAL: sem conta no assento, a busca saía sem ele e a API entregava o
     * decklist de qualquer id. Isso é indispensável desde que o id chega numa
     * INTENÇÃO do cliente: sem o dono, qualquer jogador entraria com o baralho
     * de outro — e leria a lista inteira dele. Todo assento tem conta desde que
     * o passe exige `sub`; um que não tenha não busca nada.
     */
    const dono = this.state.players.get(sessionId)?.userId ?? '';
    if (!dono) {
      this.avisarDeckAusente(
        sessionId,
        'Seu grimório não pôde ser carregado: o assento não está ligado a uma conta.',
      );
      return;
    }

    const versao = (this.provisionamento.get(sessionId) ?? 0) + 1;
    this.provisionamento.set(sessionId, versao);

    try {
      // O formato da SALA, nao o do deck: e a sala que define o que esta sendo
      // jogado. A API Core recusa ali, com a mesma mensagem de `joinMatch` —
      // sem isso, escolher um deck de 97 cartas na sala de espera dava certo e
      // a partida so quebrava depois, com todo mundo ja sentado.
      const parametros = new URLSearchParams({
        ownerId: dono,
        gameType: this.state.gameType || 'COMMANDER',
      });
      // A URL vem da config (BACKEND_CORE_URL), nunca hardcoded: era isso que
      // fazia o game-server procurar a API numa porta onde ninguem escutava.
      const res = await fetch(
        `${config.BACKEND_CORE_URL}/api/v1/internal/decks/${deckId}?${parametros.toString()}`,
        {
          // A rota interna passou a exigir segredo compartilhado: sem ele, ela
          // era um endpoint publico que entregava o decklist de qualquer id.
          headers: config.INTERNAL_API_TOKEN
            ? { 'X-Internal-Token': config.INTERNAL_API_TOKEN }
            : {},
          signal: AbortSignal.timeout(TEMPO_DA_API_MS),
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

      // Uma entrada por CÓPIA, separada por destino. Antes o `else` mandava
      // TUDO que nao fosse COMMANDER para o grimorio — inclusive SIDEBOARD e
      // MAYBEBOARD. Teto por linha: o backend limita a 99, mas um deck salvo
      // antes do limite com "2000000000 Forest" travava o processo inteiro.
      const doComando: DeckCardPayload[] = [];
      const doGrimorio: DeckCardPayload[] = [];
      const daReserva: DeckCardPayload[] = [];
      for (const card of deckReal.cards) {
        for (let i = 0; i < Math.min(card.quantity, 99); i++) {
          if (card.boardType === 'COMMANDER' || card.boardType === 'SIGNATURE_SPELL') {
            doComando.push(card);
          } else if (card.boardType === 'SIDEBOARD') {
            daReserva.push(card);
          } else if (card.boardType !== 'MAYBEBOARD') {
            // MAYBEBOARD é a lista de consideração do deckbuilder: não entra.
            doGrimorio.push(card);
          }
        }
      }

      // ANTES de limpar: um deck recusado não pode custar o que já estava na mesa.
      if (doComando.length + doGrimorio.length + daReserva.length > MAX_CARTAS_POR_GRIMORIO) {
        this.avisarDeckAusente(
          sessionId,
          `Seu grimório tem cartas demais para a mesa (o máximo é ${MAX_CARTAS_POR_GRIMORIO}).`,
        );
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
        c.scryfallId = dbCard.scryfallId;
        this.state.cards.set(c.id, c);
        return c;
      };

      for (const card of doComando) {
        // Marcado aqui, e so aqui: o comandante passa a partida inteira fora
        // da zona de comando, entao a zona nao serve para identifica-lo.
        const c = criar('COMMAND', card);
        c.isCommander = true;
        comando.push(c.id);
      }

      /**
       * ─── O GRIMÓRIO NASCE EMBARALHADO, E NÃO É EMBARALHADO DEPOIS ──────────
       *
       * As cartas eram criadas na ORDEM DO DECKLIST e só os ids eram
       * embaralhados. Só que o `Card.id` é público e o mapa `cards` chega a
       * todo cliente na ordem de inserção: quem conhece o decklist (o dono, ou
       * qualquer um, se o deck é público) casava cada id com a linha de onde
       * ele saiu — e lia o grimório inteiro na lista de `zoneOrder`.
       *
       * Agora o que se embaralha é o decklist expandido, e as cartas nascem já
       * na ordem do grimório. A ordem de inserção passa a dizer exatamente o
       * que `zoneOrder` já diz, e nada sobre o decklist. A reserva vai pelo
       * mesmo caminho: buscar uma carta dela seria apontar qual era.
       */
      for (const card of embaralhar(doGrimorio)) grimorio.push(criar('LIBRARY', card).id);
      const reserva = this.state.zoneOrder.get(zoneOrderKey(sessionId, 'SIDEBOARD'))?.items;
      for (const card of embaralhar(daReserva)) reserva?.push(criar('SIDEBOARD', card).id);

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
        this.deckIdPorSessao.set(sessionId, deckId);
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
