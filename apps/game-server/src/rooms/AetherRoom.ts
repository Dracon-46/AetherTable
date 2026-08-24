import { randomUUID } from 'node:crypto';
import { ArraySchema } from '@colyseus/schema';
import { Client, Room } from '@colyseus/core';
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
import type { z } from 'zod';
import {
  RateLimiter,
  REGISTRY,
  verificarAutorizacao,
  type IntentContext,
  type IntentHandler,
} from '../intents/registry';
import { embaralhar } from '../services/rng';
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
}

export class AetherRoom extends Room<RoomState> {
  override maxClients = REALTIME_LIMITS.MAX_PLAYERS;

  private readonly rateLimiter = new RateLimiter();
  /** Uso unico do seat token (FR-20): jti ja consumido nesta sala. */
  private readonly jtisUsados = new Set<string>();
  private proximoAssento = 0;

  override onCreate(options: { roomCode?: string }): void {
    this.setState(new RoomState());
    this.state.roomCode = options.roomCode ?? this.roomId.slice(0, 6).toUpperCase();
    this.state.phase = 'WAITING';
    this.state.startedAt = Date.now();

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
    if (claims.roomId && claims.roomId !== this.roomId) {
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
      this.state.zoneOrder.set(zoneOrderKey(client.sessionId, zone), new ArraySchema<string>());
    }

    this.provisionarDeck(client.sessionId, options.deckId);

    // O cliente precisa de uma StateView antes do primeiro patch, senao veria
    // todos os campos marcados com view().
    reconciliarClient(client, this.state);

    this.state.phase = 'PLAYING';
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
    const entradas = Object.entries(REGISTRY) as Array<
      [string, IntentHandler<z.ZodTypeAny>]
    >;

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
    };
  }

  private publicarLog(entrada: LogEvent): void {
    this.broadcast('log', entrada);
  }

  private removerJogador(sessionId: string): void {
    const player = this.state.players.get(sessionId);
    this.state.players.delete(sessionId);
    this.rateLimiter.esquecer(sessionId);

    for (const zone of ZONES) {
      this.state.zoneOrder.delete(zoneOrderKey(sessionId, zone));
    }
    this.state.cards.forEach((card, id) => {
      if (card.ownerId === sessionId) this.state.cards.delete(id);
    });

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
    const grimorio = this.state.zoneOrder.get(zoneOrderKey(sessionId, 'LIBRARY'));
    const mao = this.state.zoneOrder.get(zoneOrderKey(sessionId, 'HAND'));
    const comando = this.state.zoneOrder.get(zoneOrderKey(sessionId, 'COMMAND'));
    if (!grimorio || !mao || !comando) return;

    if (!deckId) {
      console.warn(`[${this.roomId}] Usuário entrou sem deckId`);
      return;
    }

    try {
      // A URL vem da config (BACKEND_CORE_URL), nunca hardcoded: era isso que
      // fazia o game-server procurar a API numa porta onde ninguem escutava.
      const res = await fetch(`${config.BACKEND_CORE_URL}/api/v1/internal/decks/${deckId}`);
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

      // Popula baseado no boardType (MAIN vs COMMANDER)
      for (const card of deckReal.cards) {
        for (let i = 0; i < card.quantity; i++) {
          if (card.boardType === 'COMMANDER') {
            comando.push(criar('COMMAND', card).id);
          } else {
            deckCards.push(criar('LIBRARY', card).id);
          }
        }
      }

      // Embaralhar as cartas do grimório
      const ids = embaralhar(deckCards);
      grimorio.push(...ids);

      // Saca as 7 iniciais
      for (let i = 0; i < 7; i += 1) {
        const id = grimorio.pop();
        if (!id) break;
        const c = this.state.cards.get(id);
        if (c) c.zone = 'HAND';
        mao.push(id);
      }

      const player = this.state.players.get(sessionId);
      if (player) {
        player.handCount = mao.length;
        player.libraryCount = grimorio.length;
      }
    } catch (e) {
      console.error(`[${this.roomId}] Falha ao provisionar deck ${deckId}:`, e);
    }
  }
}
