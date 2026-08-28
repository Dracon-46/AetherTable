/**
 * Registry de intencoes: o unico lugar onde uma mensagem do cliente vira mutacao
 * de estado.
 *
 * Cada entrada declara TRES coisas, e nenhuma e opcional:
 *   1. `schema` — validacao Zod do payload (FR-11).
 *   2. `autoriza` — quem pode enviar (DOC-031 §3.0.1).
 *   3. `executa`  — a mutacao.
 *
 * REGRAS DE HANDLER (DOC-021 §7 e o checklist de revisao):
 *   - NENHUM I/O (banco, HTTP) no caminho critico. Handler e sincrono.
 *   - Aleatoriedade SO via services/rng.ts (RN06).
 *   - Toda mutacao de visibilidade termina em reconciliacao.
 *   - Acao em zona oculta usa a variante neutra de log (RN09).
 */

import type { Client } from '@colyseus/core';
import type { z } from 'zod';
import {
  HIDDEN_ZONES,
  REALTIME_LIMITS,
  zoneOrderKey,
  type IntentType,
  type LogEvent,
  type ServerEventType,
  type Zone,
} from '@aethertable/shared-types';

import { Card } from '../schema/Card';
import type { RoomState } from '../schema/RoomState';
import { concede, revoga } from '../schema/visibility';
import { embaralhar, girarMoeda, rolarDado } from '../services/rng';
import {
  logCompra,
  logDado,
  logEmbaralhar,
  logOlhada,
  logTrocaZonaOculta,
  logTrocaZonaPublica,
  logVida,
  criarLog,
  logSistema,
} from '../services/log';
import { limparConcessoes, reconciliarCartaParaTodos } from '../services/view-sync';
import * as S from './schemas';

/** O que um handler recebe. Abstrai a Room para o handler ser testavel puro. */
export interface IntentContext {
  state: RoomState;
  client: Client;
  clients: Iterable<Client>;
  /** Envia SO ao remetente. Use para tudo que e informacao oculta. */
  send<T extends ServerEventType>(event: T, payload: unknown): void;
  /** Envia a todos. NUNCA use para informacao oculta. */
  broadcast<T extends ServerEventType>(event: T, payload: unknown): void;
  log(entrada: LogEvent): void;
}

export type Autorizacao = 'QUALQUER_JOGADOR' | 'CONTROLLER' | 'OWNER' | 'OWNER_DA_ZONA';

export interface IntentHandler<Schema extends z.ZodTypeAny> {
  schema: Schema;
  /**
   * Regra de autorizacao da familia. `CONTROLLER`/`OWNER` exigem que o payload
   * tenha `entityId`; a checagem e feita pelo dispatcher, nao pelo handler.
   */
  autoriza: Autorizacao;
  executa(ctx: IntentContext, payload: z.infer<Schema>): void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function carta(state: RoomState, id: string): Card | undefined {
  return state.cards.get(id);
}

function ordem(state: RoomState, playerId: string, zone: Zone) {
  return state.zoneOrder.get(zoneOrderKey(playerId, zone))?.items;
}

function nomeDe(state: RoomState, sid: string): string {
  return state.players.get(sid)?.name ?? 'Alguem';
}

function atualizarContagens(state: RoomState, playerId: string): void {
  const player = state.players.get(playerId);
  if (!player) return;
  player.handCount = ordem(state, playerId, 'HAND')?.length ?? 0;
  player.libraryCount = ordem(state, playerId, 'LIBRARY')?.length ?? 0;
}

/**
 * Efeitos colaterais obrigatorios de toda troca de zona (DOC-032 §2.1).
 * Inclui a limpeza de concessoes — o erro mais facil de cometer neste modelo.
 */
function aplicarEfeitosDeZona(ctx: IntentContext, card: Card, destino: Zone): void {
  limparConcessoes(card);

  switch (destino) {
    case 'HAND':
    case 'LIBRARY':
      card.x = 0;
      card.y = 0;
      card.zIndex = 0;
      card.isTapped = false;
      card.faceDown = false;
      card.damage = 0;
      card.counters.clear();
      break;
    case 'GRAVEYARD':
    case 'EXILE':
    case 'COMMAND':
      card.isTapped = false;
      card.damage = 0;
      card.counters.clear();
      break;
    case 'BATTLEFIELD':
      // Mantem tapped/counters apenas se veio do proprio Battlefield.
      if (card.zone !== 'BATTLEFIELD') {
        card.isTapped = false;
        card.counters.clear();
      }
      break;
    default:
      break;
  }

  card.zone = destino;
  card.lockedBy = '';

  // Fichas deixam de existir fora do campo.
  if (card.isToken && destino !== 'BATTLEFIELD') {
    ctx.state.cards.delete(card.id);
  }

  reconciliarCartaParaTodos(ctx.clients, card);
}

/** Move um id entre as listas de ordem de zona. */
function moverNaOrdem(
  state: RoomState,
  playerId: string,
  cardId: string,
  de: Zone,
  para: Zone,
  index?: number,
): void {
  const origem = ordem(state, playerId, de);
  if (origem) {
    const i = origem.indexOf(cardId);
    if (i !== -1) origem.splice(i, 1);
  }
  const destino = ordem(state, playerId, para);
  if (destino) {
    if (index === undefined) destino.push(cardId);
    else destino.splice(index, 0, cardId);
  }
}

// ─── Handlers ────────────────────────────────────────────────────────────────

const INTENT_GRAB: IntentHandler<typeof S.GrabIntent> = {
  schema: S.GrabIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    // Disputa de lock e normal, nao erro: descarta silenciosamente.
    if (c.lockedBy && c.lockedBy !== ctx.client.sessionId) return;
    c.lockedBy = ctx.client.sessionId;
  },
};

const INTENT_MOVE_CARD: IntentHandler<typeof S.MoveCardIntent> = {
  schema: S.MoveCardIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, x, y }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    // Aceito SO de quem tem o lock (FR-10).
    if (c.lockedBy !== ctx.client.sessionId) return;
    c.x = x;
    c.y = y;
  },
};

const INTENT_RELEASE: IntentHandler<typeof S.ReleaseIntent> = {
  schema: S.ReleaseIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, x, y, zIndex }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    if (c.lockedBy !== ctx.client.sessionId) return;
    c.x = x;
    c.y = y;
    if (zIndex !== undefined) c.zIndex = zIndex;
    c.lockedBy = '';
  },
};

const INTENT_CHANGE_ZONE: IntentHandler<typeof S.ChangeZoneIntent> = {
  schema: S.ChangeZoneIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, targetZone, index, x, y }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;

    const origem = c.zone as Zone;
    const nome = nomeDe(ctx.state, ctx.client.sessionId);

    moverNaOrdem(ctx.state, c.ownerId, c.id, origem, targetZone, index);
    aplicarEfeitosDeZona(ctx, c, targetZone);

    if (targetZone === 'BATTLEFIELD') {
      if (x !== undefined) c.x = x;
      if (y !== undefined) c.y = y;
    }

    atualizarContagens(ctx.state, c.ownerId);

    // Nomear a carta SO se ambas as zonas forem publicas.
    const ocultaEnvolvida =
      HIDDEN_ZONES.has(origem) || HIDDEN_ZONES.has(targetZone);
    ctx.log(
      ocultaEnvolvida
        ? logTrocaZonaOculta(ctx.client.sessionId, nome, targetZone)
        : logTrocaZonaPublica(ctx.client.sessionId, nome, 'uma carta', origem, targetZone),
    );
  },
};

const INTENT_DRAW: IntentHandler<typeof S.DrawIntent> = {
  schema: S.DrawIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { amount }) {
    const sid = ctx.client.sessionId;
    const grimorio = ordem(ctx.state, sid, 'LIBRARY');
    const mao = ordem(ctx.state, sid, 'HAND');
    if (!grimorio || !mao) return;

    // Topo do grimorio = FIM do array (stack cresce no fim).
    const compradas = Math.min(amount, grimorio.length);
    for (let i = 0; i < compradas; i += 1) {
      const id = grimorio.pop();
      if (!id) break;
      const c = carta(ctx.state, id);
      if (!c) continue;
      mao.push(id);
      aplicarEfeitosDeZona(ctx, c, 'HAND');
    }

    atualizarContagens(ctx.state, sid);
    // Nunca revela O QUE foi comprado.
    ctx.log(logCompra(sid, nomeDe(ctx.state, sid), compradas));
  },
};

const INTENT_SHUFFLE: IntentHandler<typeof S.ShuffleIntent> = {
  schema: S.ShuffleIntent,
  autoriza: 'OWNER_DA_ZONA',
  executa(ctx, { zone }) {
    const sid = ctx.client.sessionId;
    const lista = ordem(ctx.state, sid, zone);
    if (!lista) return;

    // ArraySchema nao aceita embaralhamento no lugar de forma confiavel:
    // extrai, embaralha com CSPRNG e reescreve.
    const ids = embaralhar([...lista]);
    lista.splice(0, lista.length, ...ids);

    // Embaralhar destroi qualquer olhada anterior: a ordem que o jogador viu
    // deixou de valer. Nao revogar aqui manteria conhecimento sobre cartas que
    // agora estao em outras posicoes.
    lista.forEach((id) => {
      const c = carta(ctx.state, id);
      if (!c) return;
      limparConcessoes(c);
      reconciliarCartaParaTodos(ctx.clients, c);
    });

    ctx.log(logEmbaralhar(sid, nomeDe(ctx.state, sid)));
  },
};

const INTENT_PEEK: IntentHandler<typeof S.PeekIntent> = {
  schema: S.PeekIntent,
  autoriza: 'OWNER_DA_ZONA',
  executa(ctx, { zone, amount, from }) {
    const sid = ctx.client.sessionId;
    const lista = ordem(ctx.state, sid, zone);
    if (!lista) return;

    const n = Math.min(amount, lista.length);
    const ids =
      from === 'BOTTOM'
        ? [...lista].slice(0, n)
        : [...lista].slice(lista.length - n).reverse();

    const vistas: Array<{ id: string; scryfallId: string }> = [];
    for (const id of ids) {
      const c = carta(ctx.state, id);
      if (!c) continue;
      c.peekedBy = concede(c.peekedBy, sid);
      reconciliarCartaParaTodos(ctx.clients, c);
      vistas.push({ id: c.id, scryfallId: c.scryfallId });
    }

    // SO ao dono. Um broadcast aqui vazaria o topo do grimorio para a mesa.
    ctx.send('revealToOwner', { cards: vistas });

    // Log publico com CONTAGEM, nunca identidade: os oponentes sabem QUE houve
    // uma olhada, sem saber o que foi visto. E isso que torna o historico da
    // partida uma auditoria de acesso.
    ctx.log(logOlhada(sid, nomeDe(ctx.state, sid), n));
  },
};

const INTENT_CLOSE_PEEK: IntentHandler<typeof S.ClosePeekIntent> = {
  schema: S.ClosePeekIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    ctx.state.cards.forEach((c) => {
      if (!c.peekedBy) return;
      const novo = revoga(c.peekedBy, sid);
      if (novo === c.peekedBy) return;
      c.peekedBy = novo;
      reconciliarCartaParaTodos(ctx.clients, c);
    });
  },
};

const INTENT_TAP: IntentHandler<typeof S.TapIntent> = {
  schema: S.TapIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, isTapped }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    c.isTapped = isTapped;
  },
};

const INTENT_UNTAP_ALL: IntentHandler<typeof S.UntapAllIntent> = {
  schema: S.UntapAllIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    ctx.state.cards.forEach((c) => {
      if (c.zone === 'BATTLEFIELD' && c.controllerId === sid) {
        c.isTapped = false;
      }
    });
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} desvirou todas as suas cartas.`));
  }
};

const INTENT_UPDATE_PROPERTY: IntentHandler<typeof S.UpdatePropertyIntent> = {
  schema: S.UpdatePropertyIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, property, value }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    if (property === 'rotation' && typeof value === 'number') {
      c.rotation = value;
    } else if (property === 'isTapped' && typeof value === 'boolean') {
      c.isTapped = value;
    } else if (property === 'faceDown' && typeof value === 'boolean') {
      c.faceDown = value;
      reconciliarCartaParaTodos(ctx.clients, c);
    }
  }
};

const INTENT_ADD_COUNTER: IntentHandler<typeof S.AddCounterIntent> = {
  schema: S.AddCounterIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, name, amount }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    const total = (c.counters.get(name) ?? 0) + amount;
    // Contadores sao inteiros >= 0: restricao fisica, nao julgamento de regra.
    if (total <= 0) c.counters.delete(name);
    else c.counters.set(name, total);
  },
};

const INTENT_SET_LIFE: IntentHandler<typeof S.SetLifeIntent> = {
  schema: S.SetLifeIntent,
  // Qualquer jogador pode ajustar vida de qualquer um: reflete a mesa fisica.
  // O log registra o autor, que e a auditoria que importa.
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, payload) {
    const sid = ctx.client.sessionId;
    const p = ctx.state.players.get(sid);
    if (!p) return;
    const antes = p.life;
    // Vida <= 0 NAO elimina ninguem (RN01).
    p.life = 'delta' in payload ? antes + payload.delta : payload.absolute;
    ctx.log(logVida(sid, nomeDe(ctx.state, sid), antes, p.life));
  },
};

const INTENT_ROLL_DICE: IntentHandler<typeof S.RollDiceIntent> = {
  schema: S.RollDiceIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { sides }) {
    const sid = ctx.client.sessionId;
    const resultado = rolarDado(sides);
    ctx.broadcast('dice', { actorId: sid, sides, result: resultado });
    ctx.log(logDado(sid, nomeDe(ctx.state, sid), sides, resultado));
  },
};

const INTENT_FLIP_COIN: IntentHandler<typeof S.FlipCoinIntent> = {
  schema: S.FlipCoinIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    const r = girarMoeda();
    ctx.log(criarLog('DICE', sid, `${nomeDe(ctx.state, sid)} girou a moeda: ${r}`));
  },
};

const INTENT_CHAT: IntentHandler<typeof S.ChatIntent> = {
  schema: S.ChatIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { text }) {
    const sid = ctx.client.sessionId;
    // Chat NAO e persistido (RN11). Sanitizacao final e no cliente (dompurify);
    // aqui removemos apenas caracteres de controle.
    const limpo = text.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!limpo) return;
    ctx.broadcast('chat', {
      id: `${Date.now()}-${sid}`,
      timestamp: Date.now(),
      actorId: sid,
      text: limpo,
    });
  },
};

const INTENT_PING: IntentHandler<typeof S.PingIntent> = {
  schema: S.PingIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, payload) {
    ctx.broadcast('ping', { actorId: ctx.client.sessionId, ...payload });
  },
};

const INTENT_CREATE_TOKEN: IntentHandler<typeof S.CreateTokenIntent> = {
  schema: S.CreateTokenIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, payload) {
    const fromSid = ctx.client.sessionId;
    for (let i = 0; i < payload.amount; i++) {
      const card = new Card();
      card.id = crypto.randomUUID();
      card.ownerId = fromSid;
      card.controllerId = fromSid;
      card.zone = 'BATTLEFIELD';
      card.x = payload.x + i * 20; // Offset multiple tokens
      card.y = payload.y + i * 20;
      card.isToken = true;
      if (payload.scryfallId) {
        card.scryfallId = payload.scryfallId;
      }
      if (payload.name) {
        card.note = payload.name;
      }
      
      ctx.state.cards.set(card.id, card);
      
      // Token on battlefield is visible to everyone
      reconciliarCartaParaTodos(ctx.clients, card);
    }
    
    ctx.log(logSistema(fromSid, `${nomeDe(ctx.state, fromSid)} criou ${payload.amount > 1 ? payload.amount + ' fichas' : 'uma ficha'}.`));
  }
};

const INTENT_COPY_CARD: IntentHandler<typeof S.CopyCardIntent> = {
  schema: S.CopyCardIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { entityId }) {
    const original = carta(ctx.state, entityId);
    if (!original || original.zone !== 'BATTLEFIELD') return;
    
    const sid = ctx.client.sessionId;
    const card = new Card();
    card.id = crypto.randomUUID();
    card.ownerId = original.ownerId;
    card.controllerId = sid;
    card.zone = 'BATTLEFIELD';
    card.x = original.x + 20;
    card.y = original.y + 20;
    card.scryfallId = original.scryfallId;
    card.isCopy = true;
    card.isToken = original.isToken;
    card.faceDown = original.faceDown;
    card.rotation = original.rotation;
    
    ctx.state.cards.set(card.id, card);
    reconciliarCartaParaTodos(ctx.clients, card);
    
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} criou uma cópia de carta na mesa.`));
  }
};

const INTENT_MULLIGAN: IntentHandler<typeof S.MulliganIntent> = {
  schema: S.MulliganIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    const mao = ordem(ctx.state, sid, 'HAND');
    const grimorio = ordem(ctx.state, sid, 'LIBRARY');
    const jogador = ctx.state.players.get(sid);
    if (!mao || !grimorio || !jogador) return;

    jogador.mulliganCount = (jogador.mulliganCount || 0) + 1;

    // 1. Devolve tudo da mão para o grimório
    while (mao.length > 0) {
      const id = mao.pop();
      if (id) {
        grimorio.push(id);
        const c = carta(ctx.state, id);
        if (c) aplicarEfeitosDeZona(ctx, c, 'LIBRARY');
      }
    }

    // 2. Embaralha o grimório (usa CSPRNG e limpa concessões)
    const ids = embaralhar(Array.from(grimorio));
    // Limpar o grimório
    while (grimorio.length > 0) grimorio.pop();
    // Repopular
    for (const id of ids) {
      grimorio.push(id);
    }
    grimorio.forEach((id) => {
      const c = carta(ctx.state, id);
      if (c) {
        limparConcessoes(c);
        reconciliarCartaParaTodos(ctx.clients, c);
      }
    });

    // 3. Saca 7 cartas
    const compradas = Math.min(7, grimorio.length);
    for (let i = 0; i < compradas; i += 1) {
      const id = grimorio.pop();
      if (!id) break;
      const c = carta(ctx.state, id);
      if (c) {
        mao.push(id);
        aplicarEfeitosDeZona(ctx, c, 'HAND');
      }
    }

    atualizarContagens(ctx.state, sid);
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} realizou um Mulligan (embaralhou a mão e comprou 7 cartas).`));
  }
};

// ─── Tabela ──────────────────────────────────────────────────────────────────

/**
 * Intencoes implementadas nesta fase. O contrato completo (~80 intencoes) esta
 * em `@aethertable/shared-types`; cada uma entra aqui com schema e autorizacao.
 */
export const REGISTRY = {
  INTENT_GRAB,
  INTENT_MOVE_CARD,
  INTENT_RELEASE,
  INTENT_CHANGE_ZONE,
  INTENT_CREATE_TOKEN,
  INTENT_DRAW,
  INTENT_SHUFFLE,
  INTENT_PEEK,
  INTENT_CLOSE_PEEK,
  INTENT_TAP,
  INTENT_UNTAP_ALL,
  INTENT_UPDATE_PROPERTY,
  INTENT_ADD_COUNTER,
  INTENT_SET_LIFE,
  INTENT_ROLL_DICE,
  INTENT_FLIP_COIN,
  INTENT_CHAT,
  INTENT_PING,
  INTENT_COPY_CARD,
  INTENT_MULLIGAN,
} satisfies Partial<Record<IntentType, IntentHandler<z.ZodTypeAny>>>;

export type IntentImplementada = keyof typeof REGISTRY;

export const INTENCOES_IMPLEMENTADAS = Object.keys(REGISTRY) as IntentImplementada[];

/**
 * Autorizacao. Descarta com `NOT_AUTHORIZED` quando o remetente nao tem direito.
 * Devolve `null` quando esta autorizado.
 */
export function verificarAutorizacao(
  handler: IntentHandler<z.ZodTypeAny>,
  state: RoomState,
  sid: string,
  payload: unknown,
): 'ENTITY_NOT_FOUND' | 'NOT_AUTHORIZED' | null {
  if (handler.autoriza === 'QUALQUER_JOGADOR' || handler.autoriza === 'OWNER_DA_ZONA') {
    // OWNER_DA_ZONA: o handler sempre opera sobre a zona do PROPRIO remetente,
    // porque `ordem()` e chamada com `ctx.client.sessionId`. Nao existe caminho
    // para tocar zona alheia — e a invariante que torna a trapaca inexprimivel.
    return null;
  }

  const entityId = (payload as { entityId?: unknown })?.entityId;
  if (typeof entityId !== 'string') return 'ENTITY_NOT_FOUND';

  const c = state.cards.get(entityId);
  if (!c) return 'ENTITY_NOT_FOUND';

  if (handler.autoriza === 'CONTROLLER' && c.controllerId !== sid) return 'NOT_AUTHORIZED';
  if (handler.autoriza === 'OWNER' && c.ownerId !== sid) return 'NOT_AUTHORIZED';

  return null;
}

/** Rate limit por cliente: 30 intencoes/s (NFR-04). Janela deslizante simples. */
export class RateLimiter {
  private readonly janelas = new Map<string, { inicio: number; contagem: number }>();

  permitir(sid: string, agora = Date.now()): boolean {
    const j = this.janelas.get(sid);
    if (!j || agora - j.inicio >= 1000) {
      this.janelas.set(sid, { inicio: agora, contagem: 1 });
      return true;
    }
    j.contagem += 1;
    return j.contagem <= REALTIME_LIMITS.MAX_INTENTS_PER_SECOND;
  }

  esquecer(sid: string): void {
    this.janelas.delete(sid);
  }
}
