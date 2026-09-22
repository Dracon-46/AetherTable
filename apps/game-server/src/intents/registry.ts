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
  DERROTA,
  HIDDEN_ZONES,
  REALTIME_LIMITS,
  type IntentType,
  type LogEvent,
  type ServerEventType,
  type Zone,
} from '@aethertable/shared-types';

import { Card } from '../schema/Card';
import type { RoomState } from '../schema/RoomState';
import { concede, revoga } from '../schema/visibility';
import { Arrow } from '../schema/Arrow';
import { embaralhar, embaralharMantendoTopo, sortear } from '../services/rng';
import {
  logCompra,
  nomeDaZona,
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
import { aplicarEfeitosDeZona, atualizarContagens, carta, nomeDe, ordem } from '../services/mesa';
import * as S from './schemas';
import { DescartarAoAcaso, GirarMoeda, RolarDado, SortearCarta, SortearJogador } from './sorteios';

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
  /**
   * Remove um jogador da sala AGORA, sem janela de reconexao.
   *
   * Vive no contexto (e nao no handler) porque so a Room consegue marcar a
   * saida como intencional: `onLeave` recebe apenas o booleano `consented`, que
   * e falso tanto para "fui expulso" quanto para "caiu a conexao" — e no
   * segundo caso o assento fica reservado por 90 s.
   */
  expulsar(sessionId: string): void;
}

export type Autorizacao = 'QUALQUER_JOGADOR' | 'CONTROLLER' | 'OWNER' | 'OWNER_DA_ZONA';

/**
 * A UNICA intencao que um espectador pode enviar.
 *
 * Quem assiste comenta a partida — e o conteudo inteiro de assistir. O chat nao
 * muta estado nenhum: ele transmite texto que o servidor ja limpa de caracteres
 * de controle. Toda a outra familia de intencoes mexe na mesa, e a mesa e de
 * quem tem assento.
 */
const INTENCOES_DE_ESPECTADOR = new Set<string>(['INTENT_CHAT']);

/**
 * `true` quando o remetente esta na plateia e a intencao nao e para ele.
 *
 * ─── POR QUE ISTO NAO ESTA EM `verificarAutorizacao` ────────────────────────
 *
 * Porque aquela funcao devolve `null` na hora para `QUALQUER_JOGADOR`, sem
 * checar se o remetente e mesmo um jogador — o nome da regra sempre foi uma
 * promessa que ninguem verificava, e ela nunca precisou ser verificada porque
 * ate o modo espectador existir todo mundo na sala tinha assento.
 *
 * Mudar `verificarAutorizacao` para checar isso seria a opcao elegante, mas ela
 * roda DEPOIS do parse do payload; a barreira de espectador tem de vir antes,
 * junto do rate limit, porque nem faz sentido validar o corpo de uma acao que o
 * remetente nao pode praticar.
 */
export function espectadorBarrado(state: RoomState, sid: string, intent: string): boolean {
  if (!state.espectadores.has(sid)) return false;
  return !INTENCOES_DE_ESPECTADOR.has(intent);
}

/**
 * `true` quando ainda ha assento livre na mesa.
 *
 * Conta `state.players`, e NUNCA `clients`: desde o modo espectador,
 * `this.maxClients` do Colyseus inclui a plateia (assentos + `MAX_ESPECTADORES`)
 * — contar clientes faria uma mesa de quatro lugares com tres espectadores
 * recusar o quarto jogador.
 */
export function haAssentoLivre(state: RoomState): boolean {
  return state.players.size < state.maxSeats;
}

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

/**
 * Barra quem nao e anfitriao, e devolve `true` quando ja respondeu o erro.
 *
 * ANFITRIAO E O ASSENTO 0 — e `removerJogador` reatribui assentos a cada saida,
 * entao o papel e dinamico: quem sobrar no topo da fila assume.
 *
 * A checagem estava escrita a mao dentro de `INTENT_START_MATCH` e em lugar
 * nenhum mais. As acoes que DESFAZEM o que ele fez ficaram abertas: qualquer
 * jogador podia devolver a mesa inteira para a sala de espera
 * (`INTENT_RESET_MATCH`) ou reescrever a ordem dos assentos
 * (`INTENT_SET_TURN_ORDER`) — e reescrever assentos e como se promover a
 * anfitriao, porque basta se colocar no indice 0.
 *
 * Com a regra num lugar so, a proxima acao de mesa nasce tendo onde se
 * ancorar em vez de nascer aberta.
 */
function exigirAnfitriao(ctx: IntentContext, intent: string): boolean {
  const eu = ctx.state.players.get(ctx.client.sessionId);
  if (eu && eu.seat === 0) return false;

  const anfitriao = Array.from(ctx.state.players.values()).find((p) => p.seat === 0);
  ctx.send('error', {
    code: 'NOT_HOST',
    message: anfitriao
      ? `Só o anfitrião (${anfitriao.name}) pode fazer isso.`
      : 'Só o anfitrião pode fazer isso.',
    intent,
  });
  return true;
}

// ─── DERROTA ─────────────────────────────────────────────────────────────────
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ REVERSAO CONSCIENTE DE RN01                                               │
// │                                                                           │
// │ O motor nasceu sandbox: "vida <= 0 NAO elimina ninguem". Na pratica isso  │
// │ deixava as quatro condicoes de derrota de Magic sem representacao nenhuma │
// │ — 21 de dano de comandante era um numero vermelho, veneno chegava a 10 e  │
// │ a partida seguia, e comprar de grimorio vazio comprava menos cartas EM    │
// │ SILENCIO. A mesa tinha de combinar de viva-voz quem ja tinha perdido.     │
// │                                                                           │
// │ O que RN01 protegia e que CONTINUA valendo: o eliminado nao sai da sala.  │
// │ Ele fica sentado, vendo tudo e conversando.                               │
// │                                                                           │
// │ TRES DECISOES DE DESENHO:                                                 │
// │                                                                           │
// │ 1. DERIVADO, NAO EVENTO. `eliminated` e sempre RECALCULADO a partir do    │
// │    estado atual, nunca "ligado" e esquecido. Um `-1` clicado por engano   │
// │    com 1 de vida se desfaz com `INTENT_UNDO` ou com um `+1`, e o jogador  │
// │    VOLTA. Elimidacao irreversivel num sandbox seria pior que elimicao     │
// │    nenhuma. E a mesma filosofia da reconciliacao de visibilidade.         │
// │                                                                           │
// │ 2. `decked` E A EXCECAO, e por isso e um campo PEGAJOSO. Nao e "estar sem │
// │    cartas" que mata, e TENTAR COMPRAR sem ter. Um efeito que reabasteca o │
// │    grimorio depois nao desfaz a derrota — logo, nao da para derivar isso  │
// │    do tamanho da lista.                                                   │
// │                                                                           │
// │ 3. O ANUNCIO E PUBLICO. Derrota nao e informacao oculta.                  │
// └───────────────────────────────────────────────────────────────────────────┘

/** Por que este jogador esta fora, ou `null` se esta vivo. */
function motivoDeDerrota(state: RoomState, playerId: string) {
  const p = state.players.get(playerId);
  if (!p) return null;

  if (p.conceded) return { motivo: 'CONCEDED' as const, porQuem: '' };
  if (p.decked) return { motivo: 'DECKED' as const, porQuem: '' };
  if (p.life <= DERROTA.VIDA_MINIMA) return { motivo: 'LIFE' as const, porQuem: '' };
  if (p.poison >= DERROTA.VENENO_LETAL) return { motivo: 'POISON' as const, porQuem: '' };

  // Dano de comandante e por ORIGEM: 21 de um mesmo oponente. Somar tudo seria
  // a regra errada — dois comandantes diferentes a 15 nao matam ninguem.
  let deQuem = '';
  p.commanderDamage.forEach((valor, origem) => {
    if (!deQuem && valor >= DERROTA.DANO_DE_COMANDANTE_LETAL) deQuem = origem;
  });
  if (deQuem) return { motivo: 'COMMANDER' as const, porQuem: deQuem };

  return null;
}

/**
 * Recalcula a eliminacao de um jogador e anuncia a MUDANCA.
 *
 * Idempotente: chamar dez vezes seguidas produz um anuncio so. Isso importa
 * porque ela e chamada de todo handler que mexe em vida, veneno, dano de
 * comandante ou compra — e varios deles disparam em rajada.
 */
function reavaliarEliminacao(ctx: IntentContext, playerId: string): void {
  const p = ctx.state.players.get(playerId);
  if (!p) return;

  const causa = motivoDeDerrota(ctx.state, playerId);
  const estavaFora = p.eliminated;

  if (!causa) {
    // Voltou dos mortos: a vida subiu, o veneno caiu, o golpe foi desfeito.
    if (estavaFora) {
      p.eliminated = false;
      p.eliminationReason = '';
      ctx.log(logSistema(playerId, `${p.name} voltou para a partida`));
    }
    return;
  }

  const mesmoMotivo = estavaFora && p.eliminationReason === causa.motivo;
  p.eliminated = true;
  p.eliminationReason = causa.motivo;
  if (mesmoMotivo) return;

  const porQuem = causa.porQuem ? nomeDe(ctx.state, causa.porQuem) : '';
  ctx.broadcast('playerEliminated', {
    playerId,
    name: p.name,
    reason: causa.motivo,
    ...(porQuem ? { byName: porQuem } : {}),
  });
  // `noUncheckedIndexedAccess`: o Record e indexado por string, entao o TS nao
  // sabe que `causa.motivo` sempre existe nele. O fallback tambem cobre um
  // motivo novo que alguem adicione sem passar por aqui.
  const frase = FRASE_DE_DERROTA[causa.motivo] ?? (() => 'saiu da partida');
  ctx.log(logSistema(playerId, `${p.name} ${frase(porQuem)}`));

  verificarFimDePartida(ctx);
}

const FRASE_DE_DERROTA: Record<string, (porQuem: string) => string> = {
  LIFE: () => 'perdeu: a vida chegou a zero',
  POISON: () => `perdeu: ${DERROTA.VENENO_LETAL} marcadores de veneno`,
  COMMANDER: (porQuem) =>
    `perdeu: ${DERROTA.DANO_DE_COMANDANTE_LETAL} de dano do comandante de ${porQuem || 'um oponente'}`,
  DECKED: () => 'perdeu: tentou comprar de um grimório vazio',
  CONCEDED: () => 'desistiu da partida',
};

/**
 * Sobrou um? A partida acabou.
 *
 * So anuncia com DOIS OU MAIS jogadores na mesa: numa sala de um, "voce venceu"
 * assim que a fase vira PLAYING seria absurdo.
 */
function verificarFimDePartida(ctx: IntentContext): void {
  if (ctx.state.phase !== 'PLAYING') return;
  const todos = Array.from(ctx.state.players.values());
  if (todos.length < 2) return;

  const vivos = todos.filter((p) => !p.eliminated);
  if (vivos.length !== 1) return;

  const vencedor = vivos[0]!;
  ctx.state.phase = 'CLOSING';
  ctx.broadcast('matchEnded', { winnerId: vencedor.id, winnerName: vencedor.name });
  ctx.log(logSistema(vencedor.id, `${vencedor.name} venceu a partida`));
}

/**
 * Barra quem NAO esta na vez, e devolve `true` quando ja respondeu o erro.
 *
 * ─── POR QUE ISTO VIROU HELPER ─────────────────────────────────────────────
 *
 * A checagem estava escrita a mao dentro de `INTENT_PASS_TURN` e em lugar
 * nenhum mais — e `INTENT_SET_TURN` ficou de fora. So que o botao "Avancar para
 * o turno N" do menu da mesa emite justamente `INTENT_SET_TURN`: qualquer
 * jogador empurrava o contador de turno da mesa inteira, por cima da jogada de
 * quem estava na vez. Passar o turno estava trancado; ANDAR o turno, nao.
 *
 * E o mesmo padrao que ja tinha mordido `RESET_MATCH` e `SET_TURN_ORDER`:
 * proteger a acao principal e esquecer as que fazem a mesma coisa por outro
 * caminho. Com a regra num lugar so, a proxima acao de turno nasce tendo onde
 * se ancorar.
 *
 * A excecao e a mesa sem vez definida (`activePlayerId` vazio, antes do
 * primeiro START_MATCH ou depois de um RESET): ai o primeiro a agir destrava a
 * rotacao, senao ninguem consegue comecar.
 */
function exigirVez(ctx: IntentContext, intent: string): boolean {
  const vez = ctx.state.activePlayerId;
  if (!vez || vez === ctx.client.sessionId) return false;

  const dono = ctx.state.players.get(vez);
  ctx.send('error', {
    code: 'NOT_YOUR_TURN',
    message: dono
      ? `A vez é de ${dono.name}. Só quem está na vez mexe no turno.`
      : 'Só quem está na vez mexe no turno.',
    intent,
  });
  return true;
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

    /**
     * COMPRAR DE UM GRIMORIO VAZIO FAZ PERDER.
     *
     * Antes este `Math.min` era a historia inteira: pedir 3 cartas com 1 no
     * grimorio comprava 1 e seguia a partida, sem erro, sem aviso e sem nada no
     * log. O jogador so descobria que tinha "descado" olhando o contador.
     *
     * A regra de Magic e clara e vale aqui: quem TENTA comprar sem ter, perde.
     * O que sobrou ainda vai para a mao — a derrota nao apaga a compra parcial.
     */
    const faltou = amount > grimorio.length;

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

    if (faltou) {
      const p = ctx.state.players.get(sid);
      if (p) p.decked = true;
      reavaliarEliminacao(ctx, sid);
    }
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
    // A vida pode passar de zero: e a leitura da regra, nao um clamp cosmetico.
    p.life = 'delta' in payload ? antes + payload.delta : payload.absolute;
    ctx.log(logVida(sid, nomeDe(ctx.state, sid), antes, p.life));
    reavaliarEliminacao(ctx, sid);
  },
};

/**
 * ─── A FAMILIA DE SORTEIO MORA EM `sorteios.ts` ─────────────────────────────
 *
 * As cinco intencoes ao acaso (dado, moeda, jogador, carta, descarte) sao
 * subclasses de `AcaoDeSorteio`: o esqueleto — pode? sorteia, aplica, anuncia,
 * registra — esta na classe-base, e cada uma escreve so os passos que tem.
 *
 * A instancia entra na tabela sem adaptador nenhum: `schema`, `autoriza` e
 * `executa` sao exatamente o que `IntentHandler` pede, e o dispatcher nao
 * precisa saber que do outro lado ha um metodo-template.
 */
const INTENT_ROLL_DICE = new RolarDado();

const INTENT_FLIP_COIN = new GirarMoeda();

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

/**
 * A JANELA DE MULLIGAN E UMA JANELA — E ELA PRECISA FECHAR.
 *
 * O mulligan era `QUALQUER_JOGADOR` sem nenhuma condicao: o botao continuava
 * ativo no turno seis e devolvia a mao inteira ao grimorio no meio da partida.
 * Nenhum jogador honesto queria isso, e quem queria trapacear tinha um "compre
 * sete cartas novas" permanente na barra de acoes.
 *
 * Tres condicoes fecham a janela, e qualquer uma basta:
 *   1. o jogador declarou que ficou com a mao (`keptHand`);
 *   2. a mesa passou do primeiro turno;
 *   3. ele ja tocou o jogo — tem carta no campo, no cemiterio ou no exilio.
 *
 * A terceira existe porque a segunda nao cobre a mesa que ainda esta no turno 1
 * e ja teve terreno baixado: dali em diante a mao ja informou uma decisao.
 */
function mulliganPermitido(ctx: IntentContext, sid: string): boolean {
  // A FASE E EXIGIDA MESMO NO MODO LIVRE, e essa e a linha que o `LIVRE` nao
  // pode furar: `INTENT_MULLIGAN` devolve a mao ao grimorio e embaralha. Fora
  // de `PLAYING` isso rodaria na sala de espera, sobre uma mao que ainda nao
  // foi comprada — e o "escape" viraria um jeito de embaralhar o deck de
  // graca antes de a partida existir.
  if (ctx.state.phase !== 'PLAYING') return false;
  const p = ctx.state.players.get(sid);
  if (!p) return false;

  /**
   * ─── LIVRE: SEM TETO E SEM JANELA ────────────────────────────────────────
   *
   * O formato-escape da mesa. Ele existe pela mesma razao do formato `Livre` de
   * deck: UM escape explicito e nomeado, que a mesa inteira ve no lobby, em vez
   * de meia duzia de interruptores de "ignorar regra" espalhados pela
   * interface. Quem liga isto sabe o que ligou.
   */
  if (ctx.state.tipoDeMulligan === 'LIVRE') return true;

  if (p.keptHand) return false;
  if (ctx.state.turn > 1) return false;
  // Sete mulligans em Commander ja e a mao vazia: nao existe oitavo. Vale
  // igual para LONDON — a diferenca de London e do CLIENTE, que compra sete e
  // devolve N ao fundo; o servidor faz a mesma coisa nos dois.
  if (p.mulliganCount >= 7) return false;

  let tocou = false;
  ctx.state.cards.forEach((c) => {
    if (tocou) return;
    if (c.ownerId !== sid) return;
    if (c.zone === 'BATTLEFIELD' || c.zone === 'GRAVEYARD' || c.zone === 'EXILE') tocou = true;
  });
  return !tocou;
}

const INTENT_MULLIGAN: IntentHandler<typeof S.MulliganIntent> = {
  schema: S.MulliganIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    const mao = ordem(ctx.state, sid, 'HAND');
    const grimorio = ordem(ctx.state, sid, 'LIBRARY');
    const jogador = ctx.state.players.get(sid);
    if (!mao || !grimorio || !jogador) return;

    if (!mulliganPermitido(ctx, sid)) {
      ctx.send('error', {
        code: 'MULLIGAN_CLOSED',
        message: 'A janela de mulligan já fechou — você já começou a jogar esta partida.',
        intent: 'INTENT_MULLIGAN',
      });
      return;
    }

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
        `${nomeDe(ctx.state, sid)} fez mulligan: devolveu a mão, embaralhou e comprou 7`,
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
  executa(ctx, { amount, target, faceDown }) {
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
      /**
       * DEPOIS de `aplicarEfeitosDeZona`, e nao antes.
       *
       * Ela normaliza a carta para a zona de destino e, no caminho do EXILE,
       * nao mexe em `faceDown` — mas a ordem inversa dependeria desse detalhe
       * continuar verdadeiro para sempre. Escrever por ultimo torna a intencao
       * explicita: o pedido do jogador vence a normalizacao.
       *
       * Só no exilio: no cemiterio a carta e publica por definicao, e uma carta
       * virada para baixo la seria uma zona publica escondendo conteudo.
       */
      if (faceDown && target === 'EXILE') {
        c.faceDown = true;
        reconciliarCartaParaTodos(ctx.clients, c);
      }
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
    reavaliarEliminacao(ctx, sid);
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
    reavaliarEliminacao(ctx, sid);
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
    // Continua valendo o que RN01 protegia: marca como fora do jogo, NAO
    // remove da sala. O eliminado segue sentado, vendo a mesa e conversando.
    p.conceded = true;
    reavaliarEliminacao(ctx, sid);
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

    /**
     * SO QUEM ESTA NA VEZ PASSA A VEZ.
     *
     * A intencao era `QUALQUER_JOGADOR` e nao checava nada: qualquer um podia
     * empurrar o turno a qualquer momento, inclusive por cima da jogada de
     * outra pessoa. Num sandbox sem motor de regras, o marcador de turno e o
     * UNICO combinado que a mesa tem sobre de quem e a vez — se todo mundo
     * pode mexer nele, ele nao combina nada.
     *
     * A excecao e a mesa sem vez definida (`activePlayerId` vazio, antes do
     * primeiro START_MATCH ou depois de um RESET): ai o primeiro a passar
     * inicia a rotacao, senao ninguem consegue destravar.
     */
    if (exigirVez(ctx, 'INTENT_PASS_TURN')) return;

    const atual = assentos.findIndex((p) => p.id === ctx.state.activePlayerId);
    const proximo = assentos[(atual + 1) % assentos.length];
    if (!proximo) return;

    ctx.state.activePlayerId = proximo.id;
    if (proximo.seat === 0 || atual === assentos.length - 1) {
      ctx.state.turn = Math.min(9999, ctx.state.turn + 1);
    }

    // O cronometro reinicia a cada turno. Ele CONTA E AVISA, nunca age (RN01):
    // marcar o timestamp e tudo que o servidor faz — quem decide o que fazer
    // com o tempo estourado e a mesa.
    ctx.state.turnoIniciadoEm = Date.now();

    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} passou o turno para ${proximo.name}`));
  },
};

const INTENT_RESET_MATCH: IntentHandler<typeof S.ResetMatchIntent> = {
  schema: S.ResetMatchIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    // Zerar a partida apaga a vida, os contadores e a mesa de TODO MUNDO. Era
    // a acao mais destrutiva do jogo e estava aberta a qualquer jogador, sem
    // confirmacao nenhuma — um clique errado de um convidado desfazia duas
    // horas de partida dos outros tres.
    if (exigirAnfitriao(ctx, 'INTENT_RESET_MATCH')) return;

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
      // Voltar para a sala de espera reabre a decisao: sem zerar `ready` e
      // `keptHand`, a mesa reiniciada ja nascia "toda pronta" e com a janela de
      // mulligan fechada — quer dizer, com a partida nova ja meio comecada.
      p.ready = false;
      p.keptHand = false;
      // Uma partida nova nao comeca com ninguem morto da anterior.
      p.eliminated = false;
      p.eliminationReason = '';
      p.decked = false;
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
    // Anfitriao = assento 0. Sem esta checagem, qualquer um comecaria a partida
    // por cima da sala de espera dos outros.
    if (exigirAnfitriao(ctx, 'INTENT_START_MATCH')) return;

    const eu = ctx.state.players.get(sid);
    if (!eu) return;
    if (ctx.state.phase !== 'WAITING') return;

    /**
     * SO COMECA COM A MESA INTEIRA PRONTA.
     *
     * Antes o anfitriao iniciava quando quisesse. Como a mao inicial e comprada
     * AQUI, quem ainda estava escolhendo grimorio — ou cujo deck ainda estava
     * sendo carregado da API — entrava na partida com zero cartas e passava a
     * mesa inteira assistindo, sem nenhuma mensagem que explicasse.
     *
     * O clique do anfitriao vale como o "pronto" dele: exigir que ele marque
     * pronto e depois inicie seria uma confirmacao dupla do mesmo gesto.
     */
    eu.ready = true;

    const naoProntos = Array.from(ctx.state.players.values()).filter(
      (p) => p.connected && !p.ready,
    );
    if (naoProntos.length > 0) {
      ctx.send('error', {
        code: 'NOT_ALL_READY',
        message: `Ainda faltam confirmar: ${naoProntos.map((p) => p.name).join(', ')}.`,
        intent: 'INTENT_START_MATCH',
      });
      return;
    }

    const semGrimorio = Array.from(ctx.state.players.values()).filter(
      (p) => (ordem(ctx.state, p.id, 'LIBRARY')?.length ?? 0) === 0,
    );
    if (semGrimorio.length > 0) {
      ctx.send('error', {
        code: 'NO_DECK',
        message: `Sem grimório carregado: ${semGrimorio.map((p) => p.name).join(', ')}.`,
        intent: 'INTENT_START_MATCH',
      });
      return;
    }

    ctx.state.phase = 'PLAYING';
    ctx.state.turn = 1;

    /**
     * ─── QUEM COMECA ───────────────────────────────────────────────────────
     *
     * Era `ctx.state.activePlayerId = eu.id`: QUEM CLICOU COMECAVA. Como so o
     * anfitriao pode clicar, isso era uma vantagem silenciosa dele em todas as
     * partidas — ninguem na mesa tinha combinado isso, e nada na tela dizia que
     * era assim que funcionava.
     *
     * Agora a mesa decide antes, e o sorteio e o padrao:
     *
     *   1. `jogadorInicial` preenchido — o anfitriao escolheu na sala de espera.
     *   2. `ordemPelosAssentos` ligado — o assento 0 comeca, sem sorteio.
     *   3. nenhum dos dois — SORTEIO, e o resultado vai para o log.
     *
     * O sorteio passa por `services/rng.ts` (RN06: toda aleatoriedade vem do
     * CSPRNG do servidor). Um `Math.random()` aqui seria previsivel, e prever
     * quem comeca vale mais em Commander do que parece.
     */
    const assentos = Array.from(ctx.state.players.values()).sort((a, b) => a.seat - b.seat);
    const escolhido = ctx.state.jogadorInicial;

    if (escolhido && ctx.state.players.has(escolhido)) {
      ctx.state.activePlayerId = escolhido;
      ctx.log(logSistema(sid, `${nomeDe(ctx.state, escolhido)} começa, escolhido pelo anfitrião`));
    } else if (ctx.state.ordemPelosAssentos) {
      const primeiro = assentos[0];
      ctx.state.activePlayerId = primeiro?.id ?? eu.id;
      ctx.log(logSistema(sid, `${nomeDe(ctx.state, ctx.state.activePlayerId)} começa (assento 1)`));
    } else {
      const sorteado = sortear(assentos);
      ctx.state.activePlayerId = sorteado?.id ?? eu.id;
      ctx.log(logSistema(sid, `${nomeDe(ctx.state, ctx.state.activePlayerId)} começa — sorteado`));
    }

    // O cronometro do primeiro turno comeca a contar aqui. Sem isto ele so
    // apareceria depois do primeiro PASS_TURN, e o turno inicial — que costuma
    // ser o mais longo — ficaria de fora da unica coisa que ele mede.
    ctx.state.turnoIniciadoEm = Date.now();

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
        `${nomeDe(ctx.state, sid)} devolveu ${movidas} carta(s) de ${nomeDaZona(from)} para ${nomeDaZona(to)}`,
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
        message: 'Ordem inválida.',
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
        message: 'Carta fora do grimório.',
        intent: 'INTENT_SCRY_COMMIT',
      });
      return;
    }

    /**
     * ─── `topOrder` CHEGA NA ORDEM DA TELA E ENTRA INVERTIDO ────────────────
     *
     * O topo do grimorio e o FIM do array (ver `topoDe`, logo acima). O cliente
     * manda `topOrder` na ordem em que as cartas aparecem na tela, de cima para
     * baixo -- `topOrder[0]` e a que o jogador quer comprar PRIMEIRO.
     *
     * Emendar a lista direto no fim colocava `topOrder[0]` no fundo do bloco e
     * a ULTIMA carta no topo: reordenar fazia exatamente o contrario do pedido.
     * Com scry 1 nao da para notar, porque uma carta sozinha nao tem ordem --
     * o defeito so aparece de scry 2 para cima, onde reordenar e o ponto.
     */
    const restante = Array.from(grimorio).filter((id) => !envolvidas.includes(id));
    const nova = [...toBottom, ...restante, ...[...topOrder].reverse()];
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
        message: 'Carta fora do grimório.',
        intent: 'INTENT_SURVEIL_COMMIT',
      });
      return;
    }

    // Invertido pelo mesmo motivo do scry: topo = fim do array, e `topOrder`
    // chega na ordem da tela. Ver o comentario em INTENT_SCRY_COMMIT.
    const restante = Array.from(grimorio).filter((id) => !envolvidas.includes(id));
    grimorio.splice(0, grimorio.length, ...restante, ...[...topOrder].reverse());

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
        `${nomeDe(ctx.state, sid)} concluiu o surveil (${toGraveyard.length} ao cemitério)`,
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

    ctx.log(
      logSistema(
        sid,
        `${nomeDe(ctx.state, sid)} revelou ${nomeDaZona(zone)} (${lista.length} cartas)`,
      ),
    );
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

/**
 * ─── REAPLICA O MODO "TOPO REVELADO" ───────────────────────────────────────
 *
 * Chamada UMA vez, no fim do despacho de intencao (`AetherRoom`), e nunca de
 * dentro de um handler. O motivo e a lista de coisas que mudam o topo do
 * grimorio: comprar, moer, embaralhar, mulligan, topo-para-o-fundo, reordenar,
 * confirmar scry, confirmar surveil, devolver zona, mover carta para o
 * grimorio. Dez pontos de chamada seriam dez chances de esquecer um, e o modo
 * de falhar do esquecimento nao e a carta deixar de aparecer — e uma carta que
 * NAO e mais o topo continuar revelada para a mesa.
 *
 * Idempotente de proposito: roda depois de toda intencao, inclusive das que nao
 * tocam o grimorio, e nesse caso nao escreve nada. Sem isso, ela mesma viraria
 * uma fonte de patches por segundo.
 */
export function aplicarTopoRevelado(ctx: IntentContext, sid: string): void {
  const jogador = ctx.state.players.get(sid);
  if (!jogador) return;

  const lista = ordem(ctx.state, sid, 'LIBRARY');
  const topo = lista && lista.length > 0 ? lista[lista.length - 1] : '';

  // 1. A carta revelada pelo MODO deixou de ser o topo (ou o modo caiu):
  //    desrevela. A checagem de zona evita apagar a revelacao de uma carta que
  //    ja saiu do grimorio — ao sair, `aplicarEfeitosDeZona` ja limpou.
  const anterior = jogador.topoReveladoId;
  if (anterior && (anterior !== topo || !jogador.topoRevelado)) {
    const c = ctx.state.cards.get(anterior);
    if (c && c.zone === 'LIBRARY') {
      c.revealedTo = '';
      reconciliarCartaParaTodos(ctx.clients, c);
    }
    jogador.topoReveladoId = '';
  }

  if (!jogador.topoRevelado || !topo) return;

  // 2. Revela o topo atual e anota qual e, para saber o que limpar depois.
  const nova = ctx.state.cards.get(topo);
  if (!nova) return;

  /**
   * A CONDICAO DE SAIDA OLHA A CARTA, E NAO SO O ID GUARDADO.
   *
   * Um teste pegou isto: `INTENT_SHUFFLE` chama `limparConcessoes` em cada
   * carta, entao depois de embaralhar a revelacao SUMIU — e se o acaso
   * devolvesse a mesma carta ao topo, `topoReveladoId === topo` continuava
   * verdadeiro e a reaplicacao saia achando que ja estava tudo certo. O
   * grimorio ficava com o modo ligado e nenhuma carta revelada.
   *
   * Conferir `revealedTo` faz a reaplicacao se curar sozinha depois de
   * QUALQUER handler que limpe concessoes, sem precisar conhecer a lista deles.
   * E continua idempotente: com a carta certa ja revelada, nao escreve nada.
   */
  if (jogador.topoReveladoId === topo && nova.revealedTo === 'ALL') return;

  nova.revealedTo = 'ALL';
  reconciliarCartaParaTodos(ctx.clients, nova);
  jogador.topoReveladoId = topo;
}

const INTENT_SET_TOP_REVEALED: IntentHandler<typeof S.SetTopRevealedIntent> = {
  schema: S.SetTopRevealedIntent,
  // E o proprio grimorio: nao existe alvo para autorizar contra.
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { ligado }) {
    const sid = ctx.client.sessionId;
    const jogador = ctx.state.players.get(sid);
    if (!jogador || jogador.topoRevelado === ligado) return;

    jogador.topoRevelado = ligado;
    // Quem aplica (ou limpa) a revelacao e o reconciliador do fim do despacho —
    // aqui so vira a chave. Duplicar a logica seria a segunda fonte da verdade
    // que este desenho existe para evitar.
    ctx.log(
      logSistema(
        sid,
        ligado
          ? `${nomeDe(ctx.state, sid)} passou a jogar com o topo do grimório revelado`
          : `${nomeDe(ctx.state, sid)} voltou a esconder o topo do grimório`,
      ),
    );
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
    ctx.log(
      logSistema(sid, `${nomeDe(ctx.state, sid)} mudou a visibilidade de ${nomeDaZona(zone)}`),
    );
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

/**
 * Soma dano marcado.
 *
 * Existe ao lado de `INTENT_SET_DAMAGE` (absoluto) porque o cliente NAO tem
 * como calcular o total com seguranca: ele so conhece o ultimo valor que
 * recebeu, e tres cliques em "+1" mais rapidos que o patch mandavam "1, 1, 1".
 * O absoluto continua util para "definir 5"; o delta e o que o botao usa.
 */
const INTENT_ADD_DAMAGE: IntentHandler<typeof S.AddDamageIntent> = {
  schema: S.AddDamageIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, delta }) {
    const c = carta(ctx.state, entityId);
    if (!c) return;
    // Dano e inteiro >= 0: restricao fisica, nao julgamento de regra.
    c.damage = Math.max(0, Math.min(999, c.damage + delta));
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
    // Sem isto o painel de dano continuaria sem saber o nome deste comandante.
    c.isCommander = true;
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
    reavaliarEliminacao(ctx, ctx.client.sessionId);
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
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)}: o Anel tenta no nível ${level}`));
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
    // ESCALADA DE PRIVILEGIO: a ordem VIVE nos assentos, e o assento 0 E o
    // anfitriao. Com esta intencao aberta, qualquer jogador se colocava no
    // indice 0 e virava anfitriao — ganhando START_MATCH e RESET_MATCH de
    // brinde, sem que nada na tela indicasse a troca.
    if (exigirAnfitriao(ctx, 'INTENT_SET_TURN_ORDER')) return;

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

/**
 * ─── A CONFIGURACAO DE JOGO, NUM FORMULARIO SO ──────────────────────────────
 *
 * Uma intencao para as cinco opcoes da sala de espera. Ver `SetRoomConfigIntent`
 * em `schemas.ts` para por que nao sao cinco.
 */
const INTENT_SET_ROOM_CONFIG: IntentHandler<typeof S.SetRoomConfigIntent> = {
  schema: S.SetRoomConfigIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, payload) {
    const sid = ctx.client.sessionId;
    // Primeira linha, sempre: e a regra que faltava em RESET_MATCH e
    // SET_TURN_ORDER, e ela nasce aqui em vez de ser lembrada depois.
    if (exigirAnfitriao(ctx, 'INTENT_SET_ROOM_CONFIG')) return;

    /**
     * SO NA SALA DE ESPERA.
     *
     * Trocar o tipo de mulligan com a partida em andamento e mudar a regra no
     * meio do jogo — e o cronometro e o sideboard nao sao diferentes: os tres
     * governam decisoes que os jogadores JA tomaram com base no combinado
     * anterior. Depois que a mesa comeca, mudar isso e desfazer escolha alheia.
     */
    if (ctx.state.phase !== 'WAITING') {
      ctx.send('error', {
        code: 'CONFIG_LOCKED',
        message:
          'A partida já começou — as regras da mesa foram combinadas antes e não mudam no meio. Reinicie a partida para ajustá-las.',
        intent: 'INTENT_SET_ROOM_CONFIG',
      });
      return;
    }

    if (payload.tipoDeMulligan !== undefined) {
      ctx.state.tipoDeMulligan = payload.tipoDeMulligan;
    }

    if (payload.jogadorInicial !== undefined) {
      // '' = sortear. Qualquer outro valor precisa ser alguem que esta na mesa
      // AGORA: sem esta checagem, a partida comecaria apontando para um assento
      // que ja saiu, e `activePlayerId` ficaria preso num jogador inexistente —
      // ninguem teria a vez e ninguem conseguiria passar o turno.
      if (payload.jogadorInicial !== '' && !ctx.state.players.has(payload.jogadorInicial)) {
        ctx.send('error', {
          code: 'INVALID_PAYLOAD',
          message: 'O jogador escolhido para começar não está mais na mesa.',
          intent: 'INTENT_SET_ROOM_CONFIG',
        });
        return;
      }
      ctx.state.jogadorInicial = payload.jogadorInicial;
    }

    if (payload.ordemPelosAssentos !== undefined) {
      ctx.state.ordemPelosAssentos = payload.ordemPelosAssentos;
    }
    if (payload.sideboardPermitido !== undefined) {
      ctx.state.sideboardPermitido = payload.sideboardPermitido;
    }
    if (payload.cronometroDeTurno !== undefined) {
      ctx.state.cronometroDeTurno = payload.cronometroDeTurno;
    }

    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} ajustou as regras da mesa`));
  },
};

// ─── Aleatoriedade (RN06: sempre via services/rng.ts) ────────────────────────

const INTENT_DISCARD_RANDOM = new DescartarAoAcaso();

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
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} descartou a mão (${n} cartas)`));
  },
};

const INTENT_RANDOM_PLAYER = new SortearJogador();

const INTENT_RANDOM_CARD = new SortearCarta();

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

/**
 * Marcador de turno e de fase.
 *
 * `autoriza: 'QUALQUER_JOGADOR'` continua no lugar porque a regra aqui nao e
 * sobre POSSE de entidade — e sobre a VEZ, que o dispatcher nao conhece. A
 * guarda e a primeira linha do handler.
 */
const INTENT_SET_TURN: IntentHandler<typeof S.SetTurnIntent> = {
  schema: S.SetTurnIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { turn, phase }) {
    if (exigirVez(ctx, 'INTENT_SET_TURN')) return;
    if (turn !== undefined) ctx.state.turn = turn;
    if (phase !== undefined) ctx.state.turnPhase = phase.slice(0, 32);
  },
};

const INTENT_FETCH_FROM_SIDEBOARD: IntentHandler<typeof S.FetchFromSideboardIntent> = {
  schema: S.FetchFromSideboardIntent,
  autoriza: 'OWNER',
  executa(ctx, { entityId, to }) {
    const sid = ctx.client.sessionId;

    /**
     * A RESERVA CONTINUA EXISTINDO — o que a mesa combinou foi o ACESSO.
     *
     * `sideboardPermitido` governa a troca DURANTE a partida, nao a existencia
     * da zona: o deck do jogador continua tendo reserva, ela continua visivel
     * para ele, e volta a ser alcancavel se a mesa mudar de ideia. Apagar a
     * zona seria uma decisao muito maior do que a que o anfitriao tomou ao
     * desligar um interruptor no lobby.
     */
    if (!ctx.state.sideboardPermitido) {
      ctx.send('error', {
        code: 'SIDEBOARD_LOCKED',
        message:
          'Esta mesa combinou jogar sem reserva. O anfitrião pode liberar na sala de espera.',
        intent: 'INTENT_FETCH_FROM_SIDEBOARD',
      });
      return;
    }

    const c = carta(ctx.state, entityId);
    if (!c || c.zone !== 'SIDEBOARD') return;

    moverNaOrdem(ctx.state, c.ownerId, c.id, 'SIDEBOARD', to);
    aplicarEfeitosDeZona(ctx, c, to);
    atualizarContagens(ctx.state, sid);
    ctx.log(
      criarLog(
        'ZONE_CHANGE_HIDDEN',
        sid,
        `${nomeDe(ctx.state, sid)} trouxe uma carta da reserva para ${nomeDaZona(to)}`,
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
        message: 'Nada para desfazer nos últimos 10 s.',
      });
      return;
    }
    reconciliarTudo(ctx.clients, ctx.state);
    // O snapshot restaura vida e veneno, mas nao sabe nada de eliminacao:
    // sem esta linha, desfazer o golpe letal devolvia a vida e deixava o
    // jogador morto — o pior dos dois mundos.
    reavaliarEliminacao(ctx, sid);
    ctx.log(logSistema(sid, `${nomeDe(ctx.state, sid)} desfez a última ação (${desfeita})`));
  },
};

// ═══════════════════════════════════════════════════════════════════════════
//  SALA DE ESPERA E MESA SOCIAL
//
//  Tudo aqui existe por um motivo so: as decisoes que antecedem a partida (com
//  que deck jogo, estou pronto, quem sobra na sala) nao tinham onde acontecer.
//  Eram tomadas ANTES de a sala existir — na querystring da URL — e por isso
//  nao podiam ser revistas depois que a mesa se formava.
// ═══════════════════════════════════════════════════════════════════════════

const INTENT_SET_READY: IntentHandler<typeof S.SetReadyIntent> = {
  schema: S.SetReadyIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { ready }) {
    const sid = ctx.client.sessionId;
    const p = ctx.state.players.get(sid);
    if (!p) return;
    // Prontidao so significa alguma coisa na sala de espera.
    if (ctx.state.phase !== 'WAITING') return;

    // Nao da para se declarar pronto sem grimorio: seria exatamente o estado
    // que o gate de START_MATCH existe para impedir, so que declarado a mao.
    if (ready && (ordem(ctx.state, sid, 'LIBRARY')?.length ?? 0) === 0) {
      ctx.send('error', {
        code: 'NO_DECK',
        message: 'Escolha um grimório antes de ficar pronto.',
        intent: 'INTENT_SET_READY',
      });
      return;
    }

    p.ready = ready;
    ctx.log(
      logSistema(
        sid,
        ready
          ? nomeDe(ctx.state, sid) + ' está pronto'
          : nomeDe(ctx.state, sid) + ' não está mais pronto',
      ),
    );
  },
};

const INTENT_KEEP_HAND: IntentHandler<typeof S.KeepHandIntent> = {
  schema: S.KeepHandIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx) {
    const sid = ctx.client.sessionId;
    const p = ctx.state.players.get(sid);
    if (!p || p.keptHand) return;
    p.keptHand = true;
    ctx.log(logSistema(sid, nomeDe(ctx.state, sid) + ' ficou com a mão inicial'));
  },
};

/**
 * Remove alguem da sala. So o anfitriao.
 *
 * A tela de jogadores tinha um botao que abria um `window.confirm` e, ao
 * confirmar, um `alert` dizendo que o recurso nao existia. Uma sala privada com
 * codigo compartilhado em grupo PRECISA disso: basta o codigo vazar uma vez
 * para um estranho sentar na mesa, e a unica saida era todo mundo sair e criar
 * outra sala.
 *
 * O jogador removido recebe `kicked` ANTES de a conexao cair — sem isso, a tela
 * dele mostraria apenas "conexao perdida" e ele tentaria voltar.
 */
const INTENT_KICK_PLAYER: IntentHandler<typeof S.KickPlayerIntent> = {
  schema: S.KickPlayerIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { playerId }) {
    const sid = ctx.client.sessionId;
    if (exigirAnfitriao(ctx, 'INTENT_KICK_PLAYER')) return;

    // O anfitriao sair da propria sala e `INTENT_LEAVE`, nao um chute em si
    // mesmo: sem esta linha, o assento 0 se removia e a sala ficava sem
    // ninguem que pudesse iniciar.
    if (playerId === sid) return;

    const alvo = ctx.state.players.get(playerId);
    if (!alvo) return;

    const nomeAlvo = alvo.name;
    const autor = nomeDe(ctx.state, sid);
    for (const c of ctx.clients) {
      if (c.sessionId !== playerId) continue;
      c.send('kicked', { by: autor, message: autor + ' removeu você da sala.' });
    }
    ctx.expulsar(playerId);

    ctx.log(logSistema(sid, autor + ' removeu ' + nomeAlvo + ' da sala'));
  },
};

// ─── Ver a mao e o grimorio de outro jogador, COM consentimento ─────────────
//
// Este e o unico caminho pelo qual a identidade de uma carta oculta ALHEIA sai
// do servidor. Ele passa por tres passos deliberadamente separados: pedir,
// decidir, revogar. Nenhuma intencao concede visibilidade sobre zona alheia sem
// a decisao do dono — a trapaca continua inexprimivel, e nao apenas proibida
// (RN13).

/** Zonas cujo conteudo pode ser pedido. Espelha `RequestViewIntent`. */
type ZonaPedivel = 'HAND' | 'LIBRARY' | 'GRAVEYARD' | 'EXILE';

function rotuloDeZona(zone: ZonaPedivel): string {
  switch (zone) {
    case 'HAND':
      return 'a mão';
    case 'LIBRARY':
      return 'o grimório';
    case 'GRAVEYARD':
      return 'o cemitério';
    case 'EXILE':
      return 'o exílio';
  }
}

const INTENT_REQUEST_VIEW: IntentHandler<typeof S.RequestViewIntent> = {
  schema: S.RequestViewIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { targetPlayerId, zone }) {
    const sid = ctx.client.sessionId;
    if (targetPlayerId === sid) return;
    if (!ctx.state.players.has(targetPlayerId)) return;

    for (const c of ctx.clients) {
      if (c.sessionId !== targetPlayerId) continue;
      c.send('viewRequest', {
        requesterId: sid,
        requesterName: nomeDe(ctx.state, sid),
        zone,
      });
    }

    // Log publico com a ZONA, nunca com conteudo: a mesa precisa saber que o
    // pedido existiu, mesmo que ele seja recusado.
    ctx.log(
      logSistema(
        sid,
        nomeDe(ctx.state, sid) +
          ' pediu para ver ' +
          rotuloDeZona(zone) +
          ' de ' +
          nomeDe(ctx.state, targetPlayerId),
      ),
    );
  },
};

const INTENT_RESPOND_VIEW: IntentHandler<typeof S.RespondViewIntent> = {
  schema: S.RespondViewIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { requesterId, zone, accept }) {
    const sid = ctx.client.sessionId;
    if (requesterId === sid) return;
    if (!ctx.state.players.has(requesterId)) return;

    const eu = ctx.state.players.get(sid);
    if (!eu) return;

    if (accept) {
      // A permissao vive no JOGADOR (persiste entre compras) e e aplicada
      // tambem a cada carta que ja esta na zona.
      eu.sharedZones.set(zone, concede(eu.sharedZones.get(zone) ?? '', requesterId));
      const lista = ordem(ctx.state, sid, zone as Zone);
      lista?.forEach((id) => {
        const c = carta(ctx.state, id);
        if (!c) return;
        c.revealedTo = concede(c.revealedTo, requesterId);
        reconciliarCartaParaTodos(ctx.clients, c);
      });
    }

    for (const c of ctx.clients) {
      if (c.sessionId !== requesterId) continue;
      c.send('viewResponse', {
        ownerId: sid,
        ownerName: nomeDe(ctx.state, sid),
        zone,
        accepted: accept,
      });
    }

    ctx.log(
      logSistema(
        sid,
        accept
          ? nomeDe(ctx.state, sid) +
              ' abriu ' +
              rotuloDeZona(zone) +
              ' para ' +
              nomeDe(ctx.state, requesterId)
          : nomeDe(ctx.state, sid) + ' recusou mostrar ' + rotuloDeZona(zone),
      ),
    );
  },
};

const INTENT_REVOKE_VIEW: IntentHandler<typeof S.RevokeViewIntent> = {
  schema: S.RevokeViewIntent,
  autoriza: 'QUALQUER_JOGADOR',
  executa(ctx, { viewerId, zone }) {
    const sid = ctx.client.sessionId;
    const eu = ctx.state.players.get(sid);
    if (!eu) return;

    const novo = revoga(eu.sharedZones.get(zone) ?? '', viewerId);
    if (novo) eu.sharedZones.set(zone, novo);
    else eu.sharedZones.delete(zone);

    const lista = ordem(ctx.state, sid, zone as Zone);
    lista?.forEach((id) => {
      const c = carta(ctx.state, id);
      if (!c) return;
      // `revealedTo === 'ALL'` veio de outra intencao (revelar para a mesa) e
      // nao desta permissao: revogar aqui apagaria uma revelacao publica.
      if (c.revealedTo === 'ALL') return;
      c.revealedTo = revoga(c.revealedTo, viewerId);
      reconciliarCartaParaTodos(ctx.clients, c);
    });

    ctx.log(
      logSistema(
        sid,
        nomeDe(ctx.state, sid) +
          ' fechou ' +
          rotuloDeZona(zone) +
          ' para ' +
          nomeDe(ctx.state, viewerId),
      ),
    );
  },
};

/**
 * Manda uma permanente propria para a MESA de outro jogador.
 *
 * E `INTENT_SET_CONTROLLER` com o nome que o jogador usa. O handler existia,
 * mas nenhuma tela o emitia — doar uma criatura, ou resolver qualquer efeito de
 * troca de controle, nao tinha superficie nenhuma na interface.
 *
 * `CONTROLLER` como autorizacao: quem controla a permanente hoje e quem pode
 * passa-la adiante. O dono nunca muda, e `aplicarEfeitosDeZona` devolve o
 * controle ao dono assim que a carta sai do campo.
 */
const INTENT_GIVE_CARD: IntentHandler<typeof S.GiveCardIntent> = {
  schema: S.GiveCardIntent,
  autoriza: 'CONTROLLER',
  executa(ctx, { entityId, targetPlayerId }) {
    const sid = ctx.client.sessionId;
    const c = carta(ctx.state, entityId);
    if (!c) return;
    if (!ctx.state.players.has(targetPlayerId)) return;
    if (c.zone !== 'BATTLEFIELD') return;
    if (c.controllerId === targetPlayerId) return;

    c.controllerId = targetPlayerId;
    // Coordenada e RELATIVA a faixa de quem controla (ver canvas/layout.ts):
    // manter a antiga jogaria a carta num ponto arbitrario da mesa nova.
    c.x = 0;
    c.y = 0;
    reconciliarCartaParaTodos(ctx.clients, c);

    ctx.log(
      logSistema(
        sid,
        nomeDe(ctx.state, sid) +
          ' enviou uma permanente para a mesa de ' +
          nomeDe(ctx.state, targetPlayerId),
      ),
    );
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
  INTENT_SET_TOP_REVEALED,
  INTENT_TAP_ALL,
  INTENT_ATTACH,
  INTENT_DETACH,
  INTENT_SET_PT,
  INTENT_SET_DAMAGE,
  INTENT_ADD_DAMAGE,
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
  INTENT_SET_ROOM_CONFIG,
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
  // ── sala de espera e mesa social ────────────────────────────────────────
  INTENT_SET_READY,
  INTENT_KEEP_HAND,
  INTENT_KICK_PLAYER,
  INTENT_REQUEST_VIEW,
  INTENT_RESPOND_VIEW,
  INTENT_REVOKE_VIEW,
  INTENT_GIVE_CARD,
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

/**
 * Rate limit por cliente. Janela deslizante simples.
 *
 * O padrao e o limite geral de intencoes (30/s, NFR-04). Os parametros ficaram
 * configuraveis para a sala poder ter um SEGUNDO limitador, bem mais estreito,
 * so para sorteios: dado e moeda passam de sobra no limite geral — cada rolagem
 * e uma intencao valida — mas cada uma custa um broadcast e uma linha de log em
 * todos os clientes da mesa.
 */
export class RateLimiter {
  private readonly janelas = new Map<string, { inicio: number; contagem: number }>();

  constructor(
    private readonly maximo: number = REALTIME_LIMITS.MAX_INTENTS_PER_SECOND,
    private readonly janelaMs: number = 1000,
  ) {}

  permitir(sid: string, agora = Date.now()): boolean {
    const j = this.janelas.get(sid);
    if (!j || agora - j.inicio >= this.janelaMs) {
      this.janelas.set(sid, { inicio: agora, contagem: 1 });
      return true;
    }
    j.contagem += 1;
    return j.contagem <= this.maximo;
  }

  esquecer(sid: string): void {
    this.janelas.delete(sid);
  }
}
