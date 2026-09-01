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
import { Arrow } from '../schema/Arrow';
import {
  abaixoDe,
  embaralhar,
  embaralharMantendoTopo,
  girarMoeda,
  rolarDado,
  sortear,
} from '../services/rng';
import {
  logCompra,
  logDado,
  logEmbaralhar,
  logBusca,
  logOlhada,
  logTrocaZonaOculta,
  logTrocaZonaPublica,
  logVida,
  criarLog,
  logSistema,
} from '../services/log';
import {
  limparConcessoes,
  reconciliarCartaParaTodos,
  reconciliarTudo,
} from '../services/view-sync';
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
  /**
   * Desfaz a ultima acao reversivel do remetente dentro da janela de 10 s.
   * Devolve o tipo desfeito, ou null quando nao ha nada elegivel.
   * O jornal vive na Room — ver services/undo.ts.
   */
  desfazer(): string | null;
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

  /**
   * O CONTROLE VOLTA AO DONO AO SAIR DO CAMPO (DOC-052 §2.1).
   *
   * `INTENT_SET_CONTROLLER` deixa uma permanente sob controle alheio. Sem este
   * reset, a carta roubada continuava com `controllerId` do ladrão depois de
   * morrer: ela ia para o cemitério do DONO (`ownerId` nunca muda) mas
   * continuava desenhada na faixa do ladrão, e — pior — a autorização
   * `CONTROLLER` continuava valendo. Na prática, quem roubou uma criatura uma
   * vez ganhava permissão permanente de mexer numa carta que agora está numa
   * zona do adversário.
   *
   * Controle é um estado do campo de batalha; fora dele não existe.
   */
  if (destino !== 'BATTLEFIELD' && card.controllerId !== card.ownerId) {
    card.controllerId = card.ownerId;
  }

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

    // Nomear a carta SO se ambas as zonas forem publicas E a carta estiver com
    // a face para cima. Uma permanente virada para baixo no campo continua
    // sendo informacao oculta, mesmo numa zona publica (DOC-032 §4.1, clausula 3).
    const ocultaEnvolvida = HIDDEN_ZONES.has(origem) || HIDDEN_ZONES.has(targetZone);
    ctx.log(
      ocultaEnvolvida || c.faceDown
        ? logTrocaZonaOculta(ctx.client.sessionId, nome, targetZone)
        : logTrocaZonaPublica(ctx.client.sessionId, nome, c.scryfallId, origem, targetZone),
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
  executa(ctx, { zone, keepTop }) {
    const sid = ctx.client.sessionId;
    const lista = ordem(ctx.state, sid, zone);
    if (!lista) return;

    // ArraySchema nao aceita embaralhamento no lugar de forma confiavel:
    // extrai, embaralha com CSPRNG e reescreve.
    //
    // `keepTop` fazia parte do payload desde sempre e era IGNORADO: quem pedia
    // "embaralhe mantendo as 2 do topo" tinha o topo embaralhado junto.
    const ids =
      keepTop && keepTop > 0 ? embaralharMantendoTopo([...lista], keepTop) : embaralhar([...lista]);
    lista.splice(0, lista.length, ...ids);

    // Embaralhar destroi qualquer olhada anterior: a ordem que o jogador viu
    // deixou de valer. Nao revogar aqui manteria conhecimento sobre cartas que
    // agora estao em outras posicoes.
    //
    // Excecao: as `keepTop` do topo NAO foram movidas, entao a olhada sobre
    // elas continua legitima.
    const preservadas =
      keepTop && keepTop > 0 ? new Set(topoDe(lista, keepTop)) : new Set<string>();
    lista.forEach((id) => {
      if (preservadas.has(id)) return;
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
      from === 'BOTTOM' ? [...lista].slice(0, n) : [...lista].slice(lista.length - n).reverse();

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
  },
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
  },
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
    // O dado transmite um evento efemero; a moeda so escrevia no log. A
    // assimetria nao era intencional: quem girava a moeda nao via nada
    // acontecer na mesa, e o resultado se perdia na primeira rolagem de log.
    ctx.broadcast('coin', { actorId: sid, result: r });
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
    // eslint-disable-next-line no-control-regex -- remover caracteres de controle e o objetivo da regex
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

    ctx.log(
      logSistema(
        fromSid,
        `${nomeDe(ctx.state, fromSid)} criou ${payload.amount > 1 ? payload.amount + ' fichas' : 'uma ficha'}.`,
      ),
    );
  },
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
  },
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
    ctx.log(
      logSistema(
        sid,
        `${nomeDe(ctx.state, sid)} realizou um Mulligan (embaralhou a mão e comprou 7 cartas).`,
      ),
    );
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  Intencoes que o cliente ja emitia e que o servidor ignorava em silencio.
//
//  O `intents.ts` do frontend expunha 35 emissores; este REGISTRY conhecia 20.
//  Colyseus descarta mensagem sem handler sem avisar ninguem: o botao era
//  clicado, a mensagem saia, e nada acontecia. Era a causa direta de "varias
//  funcoes nao estao funcionando".
// ═══════════════════════════════════════════════════════════════════════════

const INTENT_BRING_TO_FRONT: IntentHandler<typeof S.BringToFrontIntent> = {
  schema: S.BringToFrontIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    let maior = 0;
    ctx.state.cards.forEach((outra) => {
      if (outra.zone === 'BATTLEFIELD' && outra.zIndex > maior) maior = outra.zIndex;
    });
    c.zIndex = maior + 1;
  },
};

const INTENT_MILL: IntentHandler<typeof S.MillIntent> = {
  schema: S.MillIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { amount, target }) {
    const sid = ctx.client.sessionId;
    const grimorio = ordem(ctx.state, sid, 'LIBRARY');
    const destino = ordem(ctx.state, sid, target);
    if (!grimorio || !destino) return;

    const movidas = Math.min(amount, grimorio.length);
    for (let i = 0; i < movidas; i += 1) {
      const id = grimorio.pop();
      if (!id) break;
      const c = carta(ctx.state, id);
      if (!c) continue;
      destino.push(id);
      aplicarEfeitosDeZona(ctx, c, target);
    }

    atualizarContagens(ctx.state, sid);
    // MILL e tipo neutro: conta quantas, nunca quais.
    ctx.log(criarLog('MILL', sid, `${nomeDe(ctx.state, sid)} moeu ${movidas} carta(s)`));
  },
};

const INTENT_SET_COUNTER: IntentHandler<typeof S.SetCounterIntent> = {
  schema: S.SetCounterIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, name, value }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    if (value === 0) c.counters.delete(name);
    else c.counters.set(name, value);
  },
};

const INTENT_CLEAR_COUNTERS: IntentHandler<typeof S.ClearCountersIntent> = {
  schema: S.ClearCountersIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    c.counters.clear();
    c.damage = 0;
  },
};

const INTENT_SET_NOTE: IntentHandler<typeof S.SetNoteIntent> = {
  schema: S.SetNoteIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, text }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    // Sanitizacao minima: a anotacao e renderizada como texto na mesa de todos.
    c.note = text.replace(/[<>]/g, '').slice(0, 120);
  },
};

const INTENT_SET_HIGHLIGHT: IntentHandler<typeof S.SetHighlightIntent> = {
  schema: S.SetHighlightIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, color }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    // So aceita cor em formato conhecido: o valor vai direto para o `stroke`.
    c.highlight = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20})$/.test(color) ? color : '';
  },
};

const INTENT_SET_CONTROLLER: IntentHandler<typeof S.SetControllerIntent> = {
  schema: S.SetControllerIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, controllerId }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    // Nao da para "doar" controle a quem nao esta na mesa.
    if (!ctx.state.players.has(controllerId)) return;
    c.controllerId = controllerId;
    reconciliarCartaParaTodos(ctx.clients, c);
    ctx.log(
      logSistema(
        ctx.client.sessionId,
        `${nomeDe(ctx.state, ctx.client.sessionId)} passou o controle de uma permanente para ${nomeDe(ctx.state, controllerId)}`,
      ),
    );
  },
};

const INTENT_TRANSFORM: IntentHandler<typeof S.TransformIntent> = {
  schema: S.TransformIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    c.isFlipped = !c.isFlipped;
  },
};

const INTENT_DESTROY_TOKEN: IntentHandler<typeof S.DestroyTokenIntent> = {
  schema: S.DestroyTokenIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId }) {
    const c = carta(ctx.state, entityId);
    // So token: uma carta real precisa ir para uma zona, nunca sumir.
    if (!c || !c.isToken) return;
    ctx.state.cards.delete(entityId);
    ctx.log(
      criarLog(
        'TOKEN',
        ctx.client.sessionId,
        `${nomeDe(ctx.state, ctx.client.sessionId)} removeu um token`,
      ),
    );
  },
};

const INTENT_CLEAR_TOKENS: IntentHandler<typeof S.ClearTokensIntent> = {
  schema: S.ClearTokensIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    let removidos = 0;
    ctx.state.cards.forEach((c, id) => {
      // So os proprios tokens: limpar os tokens alheios seria acao sobre a
      // mesa de outro jogador, o que o modelo de autorizacao nao permite.
      if (c.isToken && c.controllerId === sid) {
        ctx.state.cards.delete(id);
        removidos += 1;
      }
    });
    if (removidos > 0) {
      ctx.log(criarLog('TOKEN', sid, `${nomeDe(ctx.state, sid)} removeu ${removidos} token(s)`));
    }
  },
};

const INTENT_SET_COMMANDER_DAMAGE: IntentHandler<typeof S.SetCommanderDamageIntent> = {
  schema: S.SetCommanderDamageIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { fromPlayerId, delta }) {
    const sid = ctx.client.sessionId;
    // O dano e registrado por QUEM RECEBE: cada jogador so mexe no proprio.
    const eu = ctx.state.players.get(sid);
    if (!eu || !ctx.state.players.has(fromPlayerId)) return;

    const atual = eu.commanderDamage.get(fromPlayerId) ?? 0;
    const novo = Math.max(0, Math.min(99, atual + delta));
    eu.commanderDamage.set(fromPlayerId, novo);

    ctx.log(
      criarLog(
        'CMD_DAMAGE',
        sid,
        `${nomeDe(ctx.state, sid)} marcou ${novo} de dano de comandante de ${nomeDe(ctx.state, fromPlayerId)}`,
      ),
    );
  },
};

const INTENT_ADD_PLAYER_COUNTER: IntentHandler<typeof S.AddPlayerCounterIntent> = {
  schema: S.AddPlayerCounterIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { name, amount }) {
    const sid = ctx.client.sessionId;
    const p = ctx.state.players.get(sid);
    if (!p) return;

    const limitar = (v: number) => Math.max(0, Math.min(999, v));
    switch (name) {
      case 'POISON':
        p.poison = limitar(p.poison + amount);
        break;
      case 'ENERGY':
        p.energy = limitar(p.energy + amount);
        break;
      case 'EXPERIENCE':
        p.experience = limitar(p.experience + amount);
        break;
      default:
        // RAD e TICKET ainda nao tem campo proprio no Schema.
        return;
    }

    ctx.log(criarLog('COUNTER', sid, `${nomeDe(ctx.state, sid)} ajustou seus contadores`));
  },
};

const INTENT_TOGGLE_DESIGNATION: IntentHandler<typeof S.ToggleDesignationIntent> = {
  schema: S.ToggleDesignationIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { type }) {
    const sid = ctx.client.sessionId;
    const p = ctx.state.players.get(sid);
    if (!p) return;

    // Monarca e Iniciativa sao EXCLUSIVOS da mesa: assumir tira de quem tinha.
    const campo = type === 'MONARCH' ? 'isMonarch' : 'hasInitiative';
    const jaEra = p[campo];
    ctx.state.players.forEach((outro) => {
      outro[campo] = false;
    });
    p[campo] = !jaEra;

    const rotulo = type === 'MONARCH' ? 'Monarca' : 'Iniciativa';
    ctx.log(
      logSistema(
        sid,
        p[campo]
          ? `${nomeDe(ctx.state, sid)} agora tem ${rotulo}`
          : `${nomeDe(ctx.state, sid)} abriu mao de ${rotulo}`,
      ),
    );
  },
};

const INTENT_CONCEDE: IntentHandler<typeof S.ConcedeIntent> = {
  schema: S.ConcedeIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    const p = ctx.state.players.get(sid);
    if (!p) return;
    // RN01: marca como eliminado, NAO remove da sala.
    p.conceded = true;
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} desistiu da partida`));
  },
};

const INTENT_CAST_COMMANDER: IntentHandler<typeof S.CastCommanderIntent> = {
  schema: S.CastCommanderIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId }) {
    const sid = ctx.client.sessionId;
    const c = carta(ctx.state, entityId);
    if (!c || c.zone !== 'COMMAND') return;

    moverNaOrdem(ctx.state, c.ownerId, c.id, 'COMMAND', 'BATTLEFIELD');
    c.x = 960;
    c.y = 620;
    aplicarEfeitosDeZona(ctx, c, 'BATTLEFIELD');

    const p = ctx.state.players.get(sid);
    if (p) p.commanderTax = Math.min(99, p.commanderTax + 2);

    ctx.log(
      logSistema(
        sid,
        `${nomeDe(ctx.state, sid)} conjurou o comandante (taxa: ${p?.commanderTax ?? 0})`,
      ),
    );
  },
};

const INTENT_PASS_TURN: IntentHandler<typeof S.PassTurnIntent> = {
  schema: S.PassTurnIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    // Marcador VISUAL (F29): o motor nao impoe turno, so anuncia de quem e a vez.
    const assentos = Array.from(ctx.state.players.values()).sort((a, b) => a.seat - b.seat);
    if (assentos.length === 0) return;

    const atual = assentos.findIndex((p) => p.id === ctx.state.activePlayerId);
    const proximo = assentos[(atual + 1) % assentos.length];
    if (!proximo) return;

    ctx.state.activePlayerId = proximo.id;
    if (proximo.seat === 0 || atual === assentos.length - 1) {
      ctx.state.turn = Math.min(9999, ctx.state.turn + 1);
    }

    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} passou o turno para ${proximo.name}`));
  },
};

const INTENT_RESET_MATCH: IntentHandler<typeof S.ResetMatchIntent> = {
  schema: S.ResetMatchIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    // Volta a mesa para a sala de espera. O deck ja provisionado e mantido:
    // reprovisionar exigiria I/O, proibido no caminho critico (DOC-021 §7).
    ctx.state.phase = 'WAITING';
    ctx.state.turn = 1;
    ctx.state.activePlayerId = '';

    ctx.state.players.forEach((p) => {
      p.life = 40;
      p.poison = 0;
      p.energy = 0;
      p.experience = 0;
      p.commanderTax = 0;
      p.isMonarch = false;
      p.hasInitiative = false;
      p.conceded = false;
      p.mulliganCount = 0;
      p.commanderDamage.clear();
    });

    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} reiniciou a partida`));
  },
};

const INTENT_START_MATCH: IntentHandler<typeof S.StartMatchIntent> = {
  schema: S.StartMatchIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    const eu = ctx.state.players.get(sid);
    // Anfitriao = assento 0. Sem esta checagem, qualquer um comecaria a partida
    // por cima da sala de espera dos outros.
    if (!eu || eu.seat !== 0) {
      ctx.send('error', { code: 'NOT_AUTHORIZED', message: 'So o anfitriao inicia a partida.' });
      return;
    }
    if (ctx.state.phase !== 'WAITING') return;

    ctx.state.phase = 'PLAYING';
    ctx.state.turn = 1;
    ctx.state.activePlayerId = eu.id;

    // A mao inicial e comprada AQUI, nao no `onJoin`: com a sala de espera, o
    // jogador que entra primeiro nao pode ficar com a mao na mesa enquanto os
    // outros ainda estao chegando.
    ctx.state.players.forEach((p) => {
      const grimorio = ordem(ctx.state, p.id, 'LIBRARY');
      const mao = ordem(ctx.state, p.id, 'HAND');
      if (!grimorio || !mao || mao.length > 0) return;

      const compradas = Math.min(7, grimorio.length);
      for (let i = 0; i < compradas; i += 1) {
        const id = grimorio.pop();
        if (!id) break;
        const c = carta(ctx.state, id);
        if (!c) continue;
        mao.push(id);
        aplicarEfeitosDeZona(ctx, c, 'HAND');
      }
      atualizarContagens(ctx.state, p.id);
    });

    ctx.broadcast('matchStarted', { startedBy: sid });
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} iniciou a partida`));
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  FASE 2 — paridade com DOC-036 (Catalogo de Acoes da Mesa).
//
//  Antes desta fase o REGISTRY cobria 38 das 131 acoes do catalogo. Todas as
//  acoes marcadas M (must) e S (should) para MVP/V1 entram aqui.
//
//  Tres regras valem para TODOS os handlers abaixo (DOC-021 §7):
//    - sincronos, sem I/O;
//    - aleatoriedade so via services/rng.ts (RN06);
//    - toda mutacao de visibilidade termina em reconciliacao.
// ═══════════════════════════════════════════════════════════════════════════

/** Topo do grimorio = FIM do array. Ver DOC-032 §2. */
function topoDe(lista: ArrayLike<string> & { length: number }, n: number): string[] {
  const ids: string[] = [];
  for (let i = lista.length - 1; i >= 0 && ids.length < n; i -= 1) {
    const id = lista[i];
    if (id) ids.push(id);
  }
  return ids;
}

/** Concede olhada ao remetente sobre um conjunto de cartas e reconcilia. */
function concederOlhada(
  ctx: IntentContext,
  ids: string[],
): Array<{ id: string; scryfallId: string }> {
  const sid = ctx.client.sessionId;
  const vistas: Array<{ id: string; scryfallId: string }> = [];
  for (const id of ids) {
    const c = carta(ctx.state, id);
    if (!c) continue;
    c.peekedBy = concede(c.peekedBy, sid);
    reconciliarCartaParaTodos(ctx.clients, c);
    vistas.push({ id: c.id, scryfallId: c.scryfallId });
  }
  return vistas;
}

/** Revoga a olhada do remetente sobre um conjunto de cartas. */
function revogarOlhada(ctx: IntentContext, ids: string[]): void {
  const sid = ctx.client.sessionId;
  for (const id of ids) {
    const c = carta(ctx.state, id);
    if (!c) continue;
    const novo = revoga(c.peekedBy, sid);
    if (novo === c.peekedBy) continue;
    c.peekedBy = novo;
    reconciliarCartaParaTodos(ctx.clients, c);
  }
}

// ─── Grimorio ────────────────────────────────────────────────────────────────

const INTENT_MOVE_TOP_TO_BOTTOM: IntentHandler<typeof S.MoveTopToBottomIntent> = {
  schema: S.MoveTopToBottomIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { amount }) {
    const sid = ctx.client.sessionId;
    const grimorio = ordem(ctx.state, sid, 'LIBRARY');
    if (!grimorio) return;

    const n = Math.min(amount, grimorio.length);
    for (let i = 0; i < n; i += 1) {
      const id = grimorio.pop();
      if (!id) break;
      // Fundo = INICIO do array.
      grimorio.unshift(id);
      const c = carta(ctx.state, id);
      if (c) {
        // Quem tinha olhado o topo perde o direito: a carta mudou de posicao.
        limparConcessoes(c);
        reconciliarCartaParaTodos(ctx.clients, c);
      }
    }

    ctx.log(
      criarLog(
        'SHUFFLE',
        sid,
        `${nomeDe(ctx.state, sid)} moveu ${n} carta(s) do topo para o fundo`,
      ),
    );
  },
};

const INTENT_DRAW_UP_TO: IntentHandler<typeof S.DrawUpToIntent> = {
  schema: S.DrawUpToIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { target }) {
    const sid = ctx.client.sessionId;
    const grimorio = ordem(ctx.state, sid, 'LIBRARY');
    const mao = ordem(ctx.state, sid, 'HAND');
    if (!grimorio || !mao) return;

    const faltam = Math.max(0, target - mao.length);
    const compradas = Math.min(faltam, grimorio.length);
    for (let i = 0; i < compradas; i += 1) {
      const id = grimorio.pop();
      if (!id) break;
      const c = carta(ctx.state, id);
      if (!c) continue;
      mao.push(id);
      aplicarEfeitosDeZona(ctx, c, 'HAND');
    }

    atualizarContagens(ctx.state, sid);
    ctx.log(logCompra(sid, nomeDe(ctx.state, sid), compradas));
  },
};

const INTENT_RETURN_ZONE: IntentHandler<typeof S.ReturnZoneIntent> = {
  schema: S.ReturnZoneIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { from, to, shuffle }) {
    const sid = ctx.client.sessionId;
    const origem = ordem(ctx.state, sid, from);
    const destino = ordem(ctx.state, sid, to);
    if (!origem || !destino) return;

    const movidas = origem.length;
    while (origem.length > 0) {
      const id = origem.pop();
      if (!id) break;
      const c = carta(ctx.state, id);
      if (!c) continue;
      destino.push(id);
      aplicarEfeitosDeZona(ctx, c, to);
    }

    if (shuffle) {
      const ids = embaralhar([...destino]);
      destino.splice(0, destino.length, ...ids);
      destino.forEach((id) => {
        const c = carta(ctx.state, id);
        if (!c) return;
        limparConcessoes(c);
        reconciliarCartaParaTodos(ctx.clients, c);
      });
    }

    atualizarContagens(ctx.state, sid);
    ctx.log(
      criarLog(
        'ZONE_CHANGE_HIDDEN',
        sid,
        `${nomeDe(ctx.state, sid)} devolveu ${movidas} carta(s) de ${from} para ${to}`,
      ),
    );
  },
};

const INTENT_REORDER: IntentHandler<typeof S.ReorderIntent> = {
  schema: S.ReorderIntent,
  autoriza: 'OWNER_DA_ZONA',
  executa(ctx, { zone, ids }) {
    const sid = ctx.client.sessionId;
    const lista = ordem(ctx.state, sid, zone);
    if (!lista) return;

    // So aceita uma PERMUTACAO do conteudo atual. Um `ids` com carta de fora
    // seria um jeito de mover carta alheia sem passar por CHANGE_ZONE.
    const atual = new Set(Array.from(lista));
    if (ids.length !== atual.size || ids.some((id) => !atual.has(id))) {
      ctx.send('error', {
        code: 'INVALID_PAYLOAD',
        message: 'Ordem invalida.',
        intent: 'INTENT_REORDER',
      });
      return;
    }

    lista.splice(0, lista.length, ...ids);
  },
};

// ─── Scry e Surveil: transacoes, nao "olhar + mover" ─────────────────────────
//
// DOC-036 §2.2: o jogador olha, DECIDE, e so entao o estado muda. Duas
// intencoes separadas deixariam a mesa num limbo observavel — os oponentes
// veriam o grimorio encolher antes da decisao.

const INTENT_SCRY: IntentHandler<typeof S.ScryIntent> = {
  schema: S.ScryIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { amount }) {
    const sid = ctx.client.sessionId;
    const grimorio = ordem(ctx.state, sid, 'LIBRARY');
    if (!grimorio) return;

    const ids = topoDe(grimorio, Math.min(amount, grimorio.length));
    const vistas = concederOlhada(ctx, ids);

    ctx.send('scryOpened', { mode: 'SCRY', cards: vistas });
    ctx.log(criarLog('PEEK', sid, `${nomeDe(ctx.state, sid)} fez scry ${ids.length}`));
  },
};

const INTENT_SCRY_COMMIT: IntentHandler<typeof S.ScryCommitIntent> = {
  schema: S.ScryCommitIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { toBottom, topOrder }) {
    const sid = ctx.client.sessionId;
    const grimorio = ordem(ctx.state, sid, 'LIBRARY');
    if (!grimorio) return;

    const envolvidas = [...toBottom, ...topOrder];
    const atual = new Set(Array.from(grimorio));
    if (envolvidas.some((id) => !atual.has(id))) {
      ctx.send('error', {
        code: 'INVALID_PAYLOAD',
        message: 'Carta fora do grimorio.',
        intent: 'INTENT_SCRY_COMMIT',
      });
      return;
    }

    // Remove todas as envolvidas e recoloca: fundo primeiro, topo por ultimo.
    const restante = Array.from(grimorio).filter((id) => !envolvidas.includes(id));
    const nova = [...toBottom, ...restante, ...topOrder];
    grimorio.splice(0, grimorio.length, ...nova);

    revogarOlhada(ctx, envolvidas);
    ctx.log(
      criarLog(
        'PEEK',
        sid,
        `${nomeDe(ctx.state, sid)} concluiu o scry (${toBottom.length} ao fundo)`,
      ),
    );
  },
};

const INTENT_SURVEIL: IntentHandler<typeof S.SurveilIntent> = {
  schema: S.SurveilIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { amount }) {
    const sid = ctx.client.sessionId;
    const grimorio = ordem(ctx.state, sid, 'LIBRARY');
    if (!grimorio) return;

    const ids = topoDe(grimorio, Math.min(amount, grimorio.length));
    const vistas = concederOlhada(ctx, ids);

    ctx.send('scryOpened', { mode: 'SURVEIL', cards: vistas });
    ctx.log(criarLog('PEEK', sid, `${nomeDe(ctx.state, sid)} fez surveil ${ids.length}`));
  },
};

const INTENT_SURVEIL_COMMIT: IntentHandler<typeof S.SurveilCommitIntent> = {
  schema: S.SurveilCommitIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { toGraveyard, topOrder }) {
    const sid = ctx.client.sessionId;
    const grimorio = ordem(ctx.state, sid, 'LIBRARY');
    const cemiterio = ordem(ctx.state, sid, 'GRAVEYARD');
    if (!grimorio || !cemiterio) return;

    const envolvidas = [...toGraveyard, ...topOrder];
    const atual = new Set(Array.from(grimorio));
    if (envolvidas.some((id) => !atual.has(id))) {
      ctx.send('error', {
        code: 'INVALID_PAYLOAD',
        message: 'Carta fora do grimorio.',
        intent: 'INTENT_SURVEIL_COMMIT',
      });
      return;
    }

    const restante = Array.from(grimorio).filter((id) => !envolvidas.includes(id));
    grimorio.splice(0, grimorio.length, ...restante, ...topOrder);

    for (const id of toGraveyard) {
      const c = carta(ctx.state, id);
      if (!c) continue;
      cemiterio.push(id);
      aplicarEfeitosDeZona(ctx, c, 'GRAVEYARD');
    }

    revogarOlhada(ctx, topOrder);
    atualizarContagens(ctx.state, sid);
    ctx.log(
      criarLog(
        'MILL',
        sid,
        `${nomeDe(ctx.state, sid)} concluiu o surveil (${toGraveyard.length} ao cemiterio)`,
      ),
    );
  },
};

const INTENT_SEARCH_ZONE: IntentHandler<typeof S.SearchZoneIntent> = {
  schema: S.SearchZoneIntent,
  autoriza: 'OWNER_DA_ZONA',
  executa(ctx, { zone }) {
    const sid = ctx.client.sessionId;
    const lista = ordem(ctx.state, sid, zone);
    if (!lista) return;

    // Busca = olhada sobre a zona INTEIRA. `INTENT_CLOSE_PEEK` revoga.
    const vistas = concederOlhada(ctx, Array.from(lista));
    ctx.send('revealToOwner', { cards: vistas });

    // Log publico: os oponentes precisam saber QUE houve busca (e por que o
    // grimorio sera embaralhado depois), sem saber o que foi procurado.
    ctx.log(logBusca(sid, nomeDe(ctx.state, sid), zone));
  },
};

// ─── Revelacao ───────────────────────────────────────────────────────────────

const INTENT_REVEAL: IntentHandler<typeof S.RevealIntent> = {
  schema: S.RevealIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { ids, to }) {
    const sid = ctx.client.sessionId;
    let reveladas = 0;

    for (const id of ids) {
      const c = carta(ctx.state, id);
      // So revela carta PROPRIA: revelar a carta alheia seria expor informacao
      // oculta de outro jogador, exatamente o que RN02 proibe.
      if (!c || c.ownerId !== sid) continue;
      c.revealedTo =
        to === 'ALL' ? 'ALL' : to.reduce((acc, alvo) => concede(acc, alvo), c.revealedTo);
      reconciliarCartaParaTodos(ctx.clients, c);
      reveladas += 1;
    }

    if (reveladas === 0) return;
    ctx.log(
      logSistema(
        sid,
        to === 'ALL'
          ? `${nomeDe(ctx.state, sid)} revelou ${reveladas} carta(s) para a mesa`
          : `${nomeDe(ctx.state, sid)} revelou ${reveladas} carta(s) para ${to.length} jogador(es)`,
      ),
    );
  },
};

const INTENT_REVEAL_ZONE: IntentHandler<typeof S.RevealZoneIntent> = {
  schema: S.RevealZoneIntent,
  autoriza: 'OWNER_DA_ZONA',
  executa(ctx, { zone, to }) {
    const sid = ctx.client.sessionId;
    const lista = ordem(ctx.state, sid, zone);
    if (!lista) return;

    for (const id of Array.from(lista)) {
      const c = carta(ctx.state, id);
      if (!c) continue;
      c.revealedTo =
        to === 'ALL' ? 'ALL' : to.reduce((acc, alvo) => concede(acc, alvo), c.revealedTo);
      reconciliarCartaParaTodos(ctx.clients, c);
    }

    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} revelou ${zone} (${lista.length} cartas)`));
  },
};

const INTENT_REVEAL_TOP: IntentHandler<typeof S.RevealTopIntent> = {
  schema: S.RevealTopIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { amount }) {
    const sid = ctx.client.sessionId;
    const grimorio = ordem(ctx.state, sid, 'LIBRARY');
    if (!grimorio) return;

    const ids = topoDe(grimorio, Math.min(amount, grimorio.length));
    for (const id of ids) {
      const c = carta(ctx.state, id);
      if (!c) continue;
      c.revealedTo = 'ALL';
      reconciliarCartaParaTodos(ctx.clients, c);
    }

    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} revelou ${ids.length} carta(s) do topo`));
  },
};

const INTENT_UNREVEAL: IntentHandler<typeof S.UnrevealIntent> = {
  schema: S.UnrevealIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { ids }) {
    const sid = ctx.client.sessionId;
    for (const id of ids) {
      const c = carta(ctx.state, id);
      if (!c || c.ownerId !== sid) continue;
      c.revealedTo = '';
      reconciliarCartaParaTodos(ctx.clients, c);
    }
  },
};

const INTENT_SET_ZONE_VISIBILITY: IntentHandler<typeof S.SetZoneVisibilityIntent> = {
  schema: S.SetZoneVisibilityIntent,
  autoriza: 'OWNER_DA_ZONA',
  executa(ctx, { zone, to }) {
    const sid = ctx.client.sessionId;
    const lista = ordem(ctx.state, sid, zone);
    if (!lista) return;

    for (const id of Array.from(lista)) {
      const c = carta(ctx.state, id);
      if (!c) continue;
      c.revealedTo = to === 'ALL' ? 'ALL' : to.join(',');
      reconciliarCartaParaTodos(ctx.clients, c);
    }
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} mudou a visibilidade de ${zone}`));
  },
};

// ─── Propriedades de carta ───────────────────────────────────────────────────

const INTENT_TAP_ALL: IntentHandler<typeof S.TapAllIntent> = {
  schema: S.TapAllIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    ctx.state.cards.forEach((c) => {
      if (c.zone === 'BATTLEFIELD' && c.controllerId === sid) c.isTapped = true;
    });
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} virou todas as suas cartas.`));
  },
};

const INTENT_ATTACH: IntentHandler<typeof S.AttachIntent> = {
  schema: S.AttachIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { childId, parentId }) {
    const sid = ctx.client.sessionId;
    const filho = carta(ctx.state, childId);
    const pai = carta(ctx.state, parentId);
    if (!filho || !pai || filho.id === pai.id) return;
    if (filho.controllerId !== sid) return;
    // Nada de ciclo: anexar A em B enquanto B esta anexada em A trava o grupo.
    if (pai.attachedTo === filho.id) return;
    if (filho.zone !== 'BATTLEFIELD' || pai.zone !== 'BATTLEFIELD') return;

    filho.attachedTo = pai.id;
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} anexou uma permanente a outra`));
  },
};

const INTENT_DETACH: IntentHandler<typeof S.DetachIntent> = {
  schema: S.DetachIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { childId }) {
    const c = carta(ctx.state, childId);
    if (!c) return;
    c.attachedTo = '';
  },
};

const INTENT_SET_PT: IntentHandler<typeof S.SetPtIntent> = {
  schema: S.SetPtIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, power, toughness, active }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    c.powerOverride = power;
    c.toughnessOverride = toughness;
    // Sem este booleano, "0/0" e "sem override" seriam o mesmo estado.
    c.hasPtOverride = active;
  },
};

const INTENT_SET_DAMAGE: IntentHandler<typeof S.SetDamageIntent> = {
  schema: S.SetDamageIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, amount }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    c.damage = amount;
  },
};

const INTENT_CLEAR_DAMAGE: IntentHandler<typeof S.ClearDamageIntent> = {
  schema: S.ClearDamageIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    ctx.state.cards.forEach((c) => {
      if (c.zone === 'BATTLEFIELD' && c.controllerId === sid) {
        c.damage = 0;
        c.enteredThisTurn = false;
      }
    });
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} limpou o dano das suas permanentes`));
  },
};

const INTENT_BATCH_UPDATE: IntentHandler<typeof S.BatchUpdateIntent> = {
  schema: S.BatchUpdateIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { entityIds, property, value }) {
    const sid = ctx.client.sessionId;
    // Uma mensagem para a selecao inteira: N mensagens estourariam o limite de
    // 30 intencoes/s (DOC-036 item 70).
    for (const id of entityIds) {
      const c = carta(ctx.state, id);
      if (!c || c.controllerId !== sid) continue;
      if (property === 'rotation') {
        if (typeof value === 'number') c.rotation = value;
        continue;
      }
      if (typeof value !== 'boolean') continue;
      switch (property) {
        case 'isTapped':
          c.isTapped = value;
          break;
        case 'phasedOut':
          c.phasedOut = value;
          break;
        case 'enteredThisTurn':
          c.enteredThisTurn = value;
          break;
        case 'faceDown':
          c.faceDown = value;
          // faceDown muda VISIBILIDADE: sem reconciliar, a identidade
          // continuaria saindo (ou nao chegando) para quem tem direito.
          reconciliarCartaParaTodos(ctx.clients, c);
          break;
      }
    }
  },
};

const INTENT_BATCH_COUNTER: IntentHandler<typeof S.BatchCounterIntent> = {
  schema: S.BatchCounterIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { entityIds, name, amount }) {
    const sid = ctx.client.sessionId;
    for (const id of entityIds) {
      const c = carta(ctx.state, id);
      if (!c || c.controllerId !== sid) continue;
      const atual = c.counters.get(name) ?? 0;
      const novo = atual + amount;
      if (novo === 0) c.counters.delete(name);
      else c.counters.set(name, novo);
    }
    ctx.log(
      criarLog(
        'COUNTER',
        sid,
        `${nomeDe(ctx.state, sid)} ajustou ${name} em ${entityIds.length} permanente(s)`,
      ),
    );
  },
};

const INTENT_SET_COMMANDER: IntentHandler<typeof S.SetCommanderIntent> = {
  schema: S.SetCommanderIntent,
  autoriza: 'OWNER',
  executa(ctx, { entityId }) {
    const sid = ctx.client.sessionId;
    const c = carta(ctx.state, entityId);
    if (!c) return;
    const origem = c.zone as Zone;
    moverNaOrdem(ctx.state, c.ownerId, c.id, origem, 'COMMAND');
    aplicarEfeitosDeZona(ctx, c, 'COMMAND');
    atualizarContagens(ctx.state, sid);
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} designou um comandante`));
  },
};

// ─── Jogador ─────────────────────────────────────────────────────────────────

const INTENT_SET_COMMANDER_TAX: IntentHandler<typeof S.SetCommanderTaxIntent> = {
  schema: S.SetCommanderTaxIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { delta }) {
    const p = ctx.state.players.get(ctx.client.sessionId);
    if (!p) return;
    p.commanderTax = Math.max(0, Math.min(99, p.commanderTax + delta));
  },
};

const INTENT_SET_PLAYER_COUNTER: IntentHandler<typeof S.SetPlayerCounterIntent> = {
  schema: S.SetPlayerCounterIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { type, delta }) {
    const p = ctx.state.players.get(ctx.client.sessionId);
    if (!p) return;
    const limitar = (v: number) => Math.max(0, Math.min(999, v));
    switch (type) {
      case 'POISON':
        p.poison = limitar(p.poison + delta);
        break;
      case 'ENERGY':
        p.energy = limitar(p.energy + delta);
        break;
      case 'EXPERIENCE':
        p.experience = limitar(p.experience + delta);
        break;
      case 'RAD':
        p.rad = limitar(p.rad + delta);
        break;
      case 'TICKET':
        p.ticket = limitar(p.ticket + delta);
        break;
    }
  },
};

const INTENT_SET_RING: IntentHandler<typeof S.SetRingIntent> = {
  schema: S.SetRingIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { level, bearerId }) {
    const sid = ctx.client.sessionId;
    const p = ctx.state.players.get(sid);
    if (!p) return;
    p.ringLevel = level;
    if (bearerId !== undefined) {
      const portador = carta(ctx.state, bearerId);
      p.ringBearerId = portador && portador.controllerId === sid ? portador.id : '';
    }
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)}: o Anel tenta no nivel ${level}`));
  },
};

const INTENT_SET_DAY_NIGHT: IntentHandler<typeof S.SetDayNightIntent> = {
  schema: S.SetDayNightIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { value }) {
    ctx.state.dayNight = value;
    ctx.log(logSistema(ctx.client.sessionId, `A mesa agora esta em ${value}`));
  },
};

const INTENT_SET_SPEED: IntentHandler<typeof S.SetSpeedIntent> = {
  schema: S.SetSpeedIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { value }) {
    const p = ctx.state.players.get(ctx.client.sessionId);
    if (!p) return;
    p.speed = value;
  },
};

const INTENT_SET_MAX_HAND_SIZE: IntentHandler<typeof S.SetMaxHandSizeIntent> = {
  schema: S.SetMaxHandSizeIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { value }) {
    const p = ctx.state.players.get(ctx.client.sessionId);
    if (!p) return;
    p.maxHandSize = value;
  },
};

const INTENT_SET_TURN_ORDER: IntentHandler<typeof S.SetTurnOrderIntent> = {
  schema: S.SetTurnOrderIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { order }) {
    const sid = ctx.client.sessionId;
    // A ordem VIVE nos assentos: um campo separado poderia divergir deles.
    const validos = order.filter((id) => ctx.state.players.has(id));
    if (validos.length !== ctx.state.players.size) {
      ctx.send('error', {
        code: 'INVALID_PAYLOAD',
        message: 'Ordem incompleta.',
        intent: 'INTENT_SET_TURN_ORDER',
      });
      return;
    }
    validos.forEach((id, indice) => {
      const p = ctx.state.players.get(id);
      if (p) p.seat = indice;
    });
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} definiu a ordem de turno`));
  },
};

// ─── Aleatoriedade (RN06: sempre via services/rng.ts) ────────────────────────

const INTENT_DISCARD_RANDOM: IntentHandler<typeof S.DiscardRandomIntent> = {
  schema: S.DiscardRandomIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { amount }) {
    const sid = ctx.client.sessionId;
    const mao = ordem(ctx.state, sid, 'HAND');
    const cemiterio = ordem(ctx.state, sid, 'GRAVEYARD');
    if (!mao || !cemiterio) return;

    const n = Math.min(amount, mao.length);
    for (let i = 0; i < n; i += 1) {
      const indice = abaixoDe(mao.length);
      const id = mao[indice];
      if (!id) break;
      mao.splice(indice, 1);
      const c = carta(ctx.state, id);
      if (!c) continue;
      cemiterio.push(id);
      aplicarEfeitosDeZona(ctx, c, 'GRAVEYARD');
    }

    atualizarContagens(ctx.state, sid);
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} descartou ${n} carta(s) ao acaso`));
  },
};

const INTENT_DISCARD_ALL: IntentHandler<typeof S.DiscardAllIntent> = {
  schema: S.DiscardAllIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    const mao = ordem(ctx.state, sid, 'HAND');
    const cemiterio = ordem(ctx.state, sid, 'GRAVEYARD');
    if (!mao || !cemiterio) return;

    const n = mao.length;
    while (mao.length > 0) {
      const id = mao.pop();
      if (!id) break;
      const c = carta(ctx.state, id);
      if (!c) continue;
      cemiterio.push(id);
      aplicarEfeitosDeZona(ctx, c, 'GRAVEYARD');
    }

    atualizarContagens(ctx.state, sid);
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} descartou a mao (${n} cartas)`));
  },
};

const INTENT_RANDOM_PLAYER: IntentHandler<typeof S.RandomPlayerIntent> = {
  schema: S.RandomPlayerIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const ids = Array.from(ctx.state.players.keys());
    const escolhido = sortear(ids);
    if (!escolhido) return;
    ctx.log(
      criarLog(
        'DICE',
        ctx.client.sessionId,
        `Sorteio: ${nomeDe(ctx.state, escolhido)} foi escolhido`,
      ),
    );
  },
};

const INTENT_RANDOM_CARD: IntentHandler<typeof S.RandomCardIntent> = {
  schema: S.RandomCardIntent,
  autoriza: 'OWNER_DA_ZONA',
  executa(ctx, { zone }) {
    const sid = ctx.client.sessionId;
    const lista = ordem(ctx.state, sid, zone);
    if (!lista || lista.length === 0) return;

    const id = sortear(Array.from(lista));
    if (!id) return;
    const c = carta(ctx.state, id);
    if (!c) return;

    // A identidade vai SO para o dono. Um broadcast aqui vazaria a mao.
    c.peekedBy = concede(c.peekedBy, sid);
    reconciliarCartaParaTodos(ctx.clients, c);
    ctx.send('revealToOwner', { cards: [{ id: c.id, scryfallId: c.scryfallId }] });
    ctx.log(criarLog('DICE', sid, `${nomeDe(ctx.state, sid)} sorteou uma carta de ${zone}`));
  },
};

// ─── Setas, turno e reserva ──────────────────────────────────────────────────

const INTENT_ARROW: IntentHandler<typeof S.ArrowIntent> = {
  schema: S.ArrowIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { fromId, toId, color, combat }) {
    const sid = ctx.client.sessionId;
    const origem = carta(ctx.state, fromId);
    if (!origem) return;
    // Destino pode ser carta OU jogador ("isto ataca aquele jogador").
    if (!ctx.state.cards.has(toId) && !ctx.state.players.has(toId)) return;

    // Uma seta por par origem/destino: repetir o gesto alterna em vez de
    // acumular setas identicas sobrepostas.
    let existente: string | undefined;
    ctx.state.arrows.forEach((a, id) => {
      if (a.ownerId === sid && a.fromId === fromId && a.toId === toId) existente = id;
    });
    if (existente) {
      ctx.state.arrows.delete(existente);
      return;
    }

    const seta = new Arrow();
    seta.id = `${sid}:${fromId}:${toId}`;
    seta.ownerId = sid;
    seta.fromId = fromId;
    seta.toId = toId;
    seta.color = /^#[0-9a-fA-F]{3,8}$/.test(color ?? '') ? (color as string) : '#EF4444';
    seta.combat = combat;
    ctx.state.arrows.set(seta.id, seta);
  },
};

const INTENT_CLEAR_ARROWS: IntentHandler<typeof S.ClearArrowsIntent> = {
  schema: S.ClearArrowsIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { scope }) {
    const sid = ctx.client.sessionId;
    const remover: string[] = [];
    ctx.state.arrows.forEach((a, id) => {
      if (a.ownerId !== sid) return;
      if (scope === 'MINE' || a.combat) remover.push(id);
    });
    remover.forEach((id) => ctx.state.arrows.delete(id));
  },
};

const INTENT_SET_TURN: IntentHandler<typeof S.SetTurnIntent> = {
  schema: S.SetTurnIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { turn, phase }) {
    if (turn !== undefined) ctx.state.turn = turn;
    if (phase !== undefined) ctx.state.turnPhase = phase.slice(0, 32);
  },
};

const INTENT_FETCH_FROM_SIDEBOARD: IntentHandler<typeof S.FetchFromSideboardIntent> = {
  schema: S.FetchFromSideboardIntent,
  autoriza: 'OWNER',
  executa(ctx, { entityId, to }) {
    const sid = ctx.client.sessionId;
    const c = carta(ctx.state, entityId);
    if (!c || c.zone !== 'SIDEBOARD') return;

    moverNaOrdem(ctx.state, c.ownerId, c.id, 'SIDEBOARD', to);
    aplicarEfeitosDeZona(ctx, c, to);
    atualizarContagens(ctx.state, sid);
    ctx.log(
      criarLog(
        'ZONE_CHANGE_HIDDEN',
        sid,
        `${nomeDe(ctx.state, sid)} trouxe uma carta da reserva para ${to}`,
      ),
    );
  },
};

const INTENT_LEAVE: IntentHandler<typeof S.LeaveIntent> = {
  schema: S.LeaveIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    // A desconexao em si e do `room.leave()` do cliente. Esta intencao existe
    // para marcar a saida como INTENCIONAL: sem ela, sair pela porta e cair a
    // conexao sao indistinguiveis, e a mesa fica 90 s esperando a reconexao de
    // alguem que ja foi embora. O schema existia e o handler nunca foi escrito:
    // `intents.leave()` era descartado em silencio.
    const p = ctx.state.players.get(sid);
    if (p) p.disconnectedAt = Date.now();
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} saiu da mesa`));
  },
};

const INTENT_SET_COSMETICS: IntentHandler<typeof S.SetCosmeticsIntent> = {
  schema: S.SetCosmeticsIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, payload) {
    const p = ctx.state.players.get(ctx.client.sessionId);
    if (!p) return;
    // O schema Zod ja recusou qualquer id fora do catalogo: aqui e so gravar.
    if (payload.sleeveId !== undefined) p.sleeveId = payload.sleeveId;
    if (payload.playmatId !== undefined) p.playmatId = payload.playmatId;
    if (payload.borderId !== undefined) p.profileBorder = payload.borderId;
    if (payload.titleId !== undefined) p.chatTitle = payload.titleId;
    if (payload.petId !== undefined) p.petId = payload.petId;
  },
};

const INTENT_UNDO: IntentHandler<typeof S.UndoIntent> = {
  schema: S.UndoIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    const desfeita = ctx.desfazer();
    if (!desfeita) {
      ctx.send('warning', {
        code: 'RATE_LIMITED',
        message: 'Nada para desfazer nos ultimos 10 s.',
      });
      return;
    }
    reconciliarTudo(ctx.clients, ctx.state);
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} desfez a ultima acao (${desfeita})`));
  },
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
  INTENT_BRING_TO_FRONT,
  INTENT_MILL,
  INTENT_SET_COUNTER,
  INTENT_CLEAR_COUNTERS,
  INTENT_SET_NOTE,
  INTENT_SET_HIGHLIGHT,
  INTENT_SET_CONTROLLER,
  INTENT_TRANSFORM,
  INTENT_DESTROY_TOKEN,
  INTENT_CLEAR_TOKENS,
  INTENT_SET_COMMANDER_DAMAGE,
  INTENT_ADD_PLAYER_COUNTER,
  INTENT_TOGGLE_DESIGNATION,
  INTENT_CONCEDE,
  INTENT_CAST_COMMANDER,
  INTENT_PASS_TURN,
  INTENT_RESET_MATCH,
  INTENT_START_MATCH,
  // ── fase 2: paridade com DOC-036 ────────────────────────────────────────
  INTENT_MOVE_TOP_TO_BOTTOM,
  INTENT_DRAW_UP_TO,
  INTENT_RETURN_ZONE,
  INTENT_REORDER,
  INTENT_SCRY,
  INTENT_SCRY_COMMIT,
  INTENT_SURVEIL,
  INTENT_SURVEIL_COMMIT,
  INTENT_SEARCH_ZONE,
  INTENT_REVEAL,
  INTENT_REVEAL_ZONE,
  INTENT_REVEAL_TOP,
  INTENT_UNREVEAL,
  INTENT_SET_ZONE_VISIBILITY,
  INTENT_TAP_ALL,
  INTENT_ATTACH,
  INTENT_DETACH,
  INTENT_SET_PT,
  INTENT_SET_DAMAGE,
  INTENT_CLEAR_DAMAGE,
  INTENT_BATCH_UPDATE,
  INTENT_BATCH_COUNTER,
  INTENT_SET_COMMANDER,
  INTENT_SET_COMMANDER_TAX,
  INTENT_SET_PLAYER_COUNTER,
  INTENT_SET_RING,
  INTENT_SET_DAY_NIGHT,
  INTENT_SET_SPEED,
  INTENT_SET_MAX_HAND_SIZE,
  INTENT_SET_TURN_ORDER,
  INTENT_DISCARD_RANDOM,
  INTENT_DISCARD_ALL,
  INTENT_RANDOM_PLAYER,
  INTENT_RANDOM_CARD,
  INTENT_ARROW,
  INTENT_CLEAR_ARROWS,
  INTENT_SET_TURN,
  INTENT_FETCH_FROM_SIDEBOARD,
  INTENT_LEAVE,
  INTENT_SET_COSMETICS,
  INTENT_UNDO,
} satisfies Partial<Record<IntentType, IntentHandler<z.ZodTypeAny>>>;

export type IntentImplementada = keyof typeof REGISTRY;

/**
 * O que do catalogo (DOC-036) segue fora do REGISTRY, e por que.
 *
 * Todas sao prioridade C (could) / V2 e exigem estrutura de dominio nova — nao
 * apenas um handler. Estao listadas aqui para que a lacuna seja explicita e
 * verificavel, em vez de descoberta por um jogador clicando num botao inerte
 * (que foi exatamente o que aconteceu com as 18 intencoes da fase 1).
 */
export const INTENCOES_PENDENTES: ReadonlyArray<{ intent: IntentType; motivo: string }> = [
  { intent: 'INTENT_MELD', motivo: 'V2 — exige carta resultante e desfazer o meld' },
  { intent: 'INTENT_GROUP', motivo: 'V2 — exige um id de grupo no Schema de Card' },
  { intent: 'INTENT_CREATE_EMBLEM', motivo: 'V2 — exige zona/objeto de emblema' },
  { intent: 'INTENT_VENTURE', motivo: 'V2 — exige os mapas das masmorras' },
  { intent: 'INTENT_PLANESWALK', motivo: 'V2 — Planechase: deck de planos' },
  { intent: 'INTENT_DRAW_SCHEME', motivo: 'V2 — Archenemy: deck de esquemas' },
];

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
