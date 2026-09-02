import { randomUUID } from 'node:crypto';
import type { Client } from '@colyseus/core';
import { Room } from '@colyseus/core';
import jwt from 'jsonwebtoken';
import {
  REALTIME_LIMITS,
  ZONES,
  zoneOrderKey,
  type JoinOptions,
  type LogEvent,
  type Zone,
} from '@aethertable/shared-types';

import { config } from '../config';
import { Card } from '../schema/Card';
import { Player } from '../schema/Player';
import { RoomState } from '../schema/RoomState';
import { ZoneOrderList } from '../schema/ZoneOrderList';
import type { z } from 'zod';
import {
  RateLimiter,
  REGISTRY,
  verificarAutorizacao,
  type IntentContext,
  type IntentHandler,
} from '../intents/registry';
import { embaralhar } from '../services/rng';
import { JornalUndo } from '../services/undo';
import { logSistema } from '../services/log';
import { reconciliarClient, reconciliarTudo } from '../services/view-sync';
import { intentsRecebidas, intentsRejeitadas, salasAtivas } from '../metrics';

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
}

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
  /** Janela de arrependimento de 10 s por jogador (DOC-036 item 130). */
  private readonly jornal = new JornalUndo();
  /** Uso unico do seat token (FR-20): jti ja consumido nesta sala. */
  private readonly jtisUsados = new Set<string>();
  /**
   * Quem o anfitriao removeu. Um `client.leave()` partindo do SERVIDOR chega em
   * `onLeave` com `consented === false` — indistinguivel de uma queda de
   * conexao — e a sala guardaria o assento do expulso por 90 s esperando uma
   * reconexao que nao deve acontecer.
   */
  private readonly expulsos = new Set<string>();
  private proximoAssento = 0;

  override onCreate(options: { roomCode?: string; maxClients?: number; gameType?: string }): void {
    this.setState(new RoomState());
    this.state.roomCode = options.roomCode ?? this.roomId.slice(0, 6).toUpperCase();
    this.state.phase = 'WAITING';
    this.state.startedAt = Date.now();

    if (options.maxClients) {
      // O teto era `MAX_PLAYERS * 2`, quer dizer: a constante que diz "maximo de
      // jogadores" nao era o maximo de jogadores. Uma sala aceitava o dobro do
      // que qualquer outra parte do sistema assumia — inclusive a mesa, que
      // desenha uma faixa por assento.
      this.maxClients = Math.max(2, Math.min(REALTIME_LIMITS.MAX_PLAYERS, options.maxClients));
    }
    this.state.maxSeats = this.maxClients;
    this.state.gameType = options.gameType ?? 'COMMANDER';

    // 20 Hz: mutacoes na mesma janela viram um patch. Arrastar uma carta nao
    // gera 60 pacotes por segundo.
    this.setPatchRate(REALTIME_LIMITS.PATCH_RATE_MS);

    this.registrarIntencoes();
    this.registrarIntencoesComIO();
    salasAtivas.inc();
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

    if (claims.jti) {
      if (this.jtisUsados.has(claims.jti)) throw new Error('TOKEN_ALREADY_USED');
      this.jtisUsados.add(claims.jti);
    }

    return claims;
  }

  override onJoin(client: Client, options: JoinOptions, auth: SeatTokenClaims): void {
    const player = new Player();
    player.id = client.sessionId;
    player.userId = auth.sub;
    player.name = auth.username;
    player.seat = this.proximoAssento;
    this.proximoAssento += 1;

    this.state.players.set(client.sessionId, player);

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
  }

  override async onLeave(client: Client, consented: boolean): Promise<void> {
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
      if (player) {
        player.connected = true;
        player.disconnectedAt = 0;
      }
      // A view nao sobrevive a reconexao: reconstruir e obrigatorio.
      reconciliarClient(client, this.state);
      this.broadcast('playerReconnected', { playerId: client.sessionId });
    } catch {
      this.removerJogador(client.sessionId);
    }
  }

  override onDispose(): void {
    salasAtivas.dec();
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
          // O snapshot e tirado ANTES da mutacao e so para intencoes
          // reversiveis — a propria lista de exclusoes vive em services/undo.ts.
          this.jornal.registrar(this.state, client.sessionId, tipo);
          handler.executa(this.montarContexto(client), parsed.data);
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
      desfazer: () => this.jornal.desfazer(this.state, client.sessionId),
      expulsar: (sessionId) => this.expulsar(sessionId),
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
    const client = this.clients.find((c) => c.sessionId === sessionId);
    // 4000+ e a faixa de codigos de aplicacao do WebSocket: o cliente distingue
    // "fui removido" de "a conexao caiu".
    client?.leave(4001);
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
      // andamento. So na sala de espera.
      if (this.state.phase !== 'WAITING') {
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
    this.state.players.delete(sessionId);
    this.rateLimiter.esquecer(sessionId);
    this.jornal.esquecer(sessionId);

    for (const zone of ZONES) {
      this.state.zoneOrder.delete(zoneOrderKey(sessionId, zone));
    }
    this.state.cards.forEach((card, id) => {
      if (card.ownerId === sessionId) this.state.cards.delete(id);
    });

    // Reatribui assentos: `proximoAssento` so crescia, entao apos qualquer
    // saida ninguem mais ocupava o assento 0 — e sem assento 0 nao existe
    // anfitriao para iniciar a partida.
    const restantes = Array.from(this.state.players.values()).sort((a, b) => a.seat - b.seat);
    restantes.forEach((p, indice) => {
      p.seat = indice;
    });
    this.proximoAssento = restantes.length;

    this.broadcast('playerLeft', { playerId: sessionId, name: player?.name ?? '' });

    // As cartas do jogador sairam: as views dos demais precisam ser recalculadas.
    reconciliarTudo(this.clients, this.state);
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

    // Uma segunda escolha substitui a primeira; sem isto os dois decks se
    // somavam dentro das mesmas listas de zona.
    this.limparCartasDe(sessionId);

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
      for (const card of deckReal.cards) {
        for (let i = 0; i < card.quantity; i++) {
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
