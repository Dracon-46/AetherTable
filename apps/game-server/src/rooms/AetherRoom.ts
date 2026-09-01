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
  deckId: string;
}

export class AetherRoom extends Room<RoomState> {
  override maxClients: number = REALTIME_LIMITS.MAX_PLAYERS;

  private readonly rateLimiter = new RateLimiter();
  /** Janela de arrependimento de 10 s por jogador (DOC-036 item 130). */
  private readonly jornal = new JornalUndo();
  /** Uso unico do seat token (FR-20): jti ja consumido nesta sala. */
  private readonly jtisUsados = new Set<string>();
  private proximoAssento = 0;

  override onCreate(options: { roomCode?: string; maxClients?: number; gameType?: string }): void {
    this.setState(new RoomState());
    this.state.roomCode = options.roomCode ?? this.roomId.slice(0, 6).toUpperCase();
    this.state.phase = 'WAITING';
    this.state.startedAt = Date.now();

    if (options.maxClients) {
      this.maxClients = Math.max(2, Math.min(REALTIME_LIMITS.MAX_PLAYERS * 2, options.maxClients));
    }
    this.state.maxSeats = this.maxClients;
    this.state.gameType = options.gameType ?? 'COMMANDER';

    // 20 Hz: mutacoes na mesma janela viram um patch. Arrastar uma carta nao
    // gera 60 pacotes por segundo.
    this.setPatchRate(REALTIME_LIMITS.PATCH_RATE_MS);

    this.registrarIntencoes();
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

    void this.provisionarDeck(client.sessionId, auth.deckId);

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

    if (consented) {
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
            message: 'Muitas acoes por segundo. Algumas foram descartadas.',
          });
          return;
        }

        const parsed = handler.schema.safeParse(payload);
        if (!parsed.success) {
          intentsRejeitadas.inc({ reason: 'invalid_payload' });
          // Nunca inclui nome de carta na mensagem de erro (DOC-031 §5.4).
          client.send('error', {
            code: 'INVALID_PAYLOAD',
            message: 'Payload rejeitado pela validacao.',
            intent: tipo,
          });
          return;
        }

        const negado = verificarAutorizacao(handler, this.state, client.sessionId, parsed.data);
        if (negado) {
          intentsRejeitadas.inc({ reason: negado.toLowerCase() });
          client.send('error', { code: negado, message: 'Acao nao permitida.', intent: tipo });
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
          client.send('error', { code: 'INTERNAL', message: 'Erro interno.', intent: tipo });
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
    };
  }

  private publicarLog(entrada: LogEvent): void {
    this.broadcast('log', entrada);
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
      console.warn(`[${this.roomId}] Usuário entrou sem deckId`);
      this.avisarDeckAusente(
        sessionId,
        'Você entrou sem deck selecionado — a mesa abre vazia. Volte à Taverna e escolha um deck antes de entrar.',
      );
      return;
    }

    try {
      // A URL vem da config (BACKEND_CORE_URL), nunca hardcoded: era isso que
      // fazia o game-server procurar a API numa porta onde ninguem escutava.
      const res = await fetch(`${config.BACKEND_CORE_URL}/api/v1/internal/decks/${deckId}`, {
        // A rota interna passou a exigir segredo compartilhado: sem ele, ela
        // era um endpoint publico que entregava o decklist de qualquer id.
        headers: config.INTERNAL_API_TOKEN ? { 'X-Internal-Token': config.INTERNAL_API_TOKEN } : {},
      });
      if (!res.ok) throw new Error('Deck não encontrado');
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
            case 'SIGNATURE_SPELL':
              comando.push(criar('COMMAND', card).id);
              break;
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
      }

      // RECONCILIAR TUDO AQUI: Garante que as cartas recém criadas e
      // assinaladas para a mão (HAND) / comando (COMMAND) recebam a view
      // correta e sejam visíveis para o dono!
      reconciliarTudo(this.clients, this.state);
    } catch (e) {
      console.error(`[${this.roomId}] Falha ao provisionar deck ${deckId}:`, e);
      this.avisarDeckAusente(
        sessionId,
        'Seu deck não pôde ser carregado do servidor — você entra na mesa sem cartas. Volte à Taverna e entre de novo.',
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
  private avisarDeckAusente(sessionId: string, message: string): void {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    client?.send('deckError', { code: 'DECK_UNAVAILABLE', message });
    this.publicarLog(logSistema(sessionId, message));
  }
}
