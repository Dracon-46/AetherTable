/**
 * Contrato SERVIDOR -> CLIENTE: eventos efemeros (mensagens nomeadas).
 *
 * O estado durável da mesa viaja por PATCH BINARIO do Colyseus, nao por aqui.
 * Estes eventos sao acontecimentos: um dado rolado nao e estado da mesa.
 * Coloca-lo no `Schema` obrigaria a decidir quando remove-lo e geraria patches
 * inuteis.
 *
 * Fonte canonica: docs/especificacao_websocket_e_eventos.md §4.
 *
 * CUIDADO DE VAZAMENTO (DOC-031 §5.4): o `@filter` protege o ESTADO. Eventos
 * efemeros exigem disciplina manual —
 *   - `revealToOwner` vai por `client.send()`, NUNCA por `broadcast`;
 *   - acao em zona oculta usa a variante `_HIDDEN` de LogType;
 *   - nunca incluir nome de carta em `warning` ou `error`.
 */

import type { DiceSides, IntentError, IntentType } from './intents';
import type { HandshakeError } from './room';

/** Tipos de entrada do log. Todos neutros (RN09). */
export const LOG_TYPES = [
  'DRAW',
  'PLAY',
  'ZONE_CHANGE',
  /** Variante obrigatoria quando a zona de origem ou destino e oculta. */
  'ZONE_CHANGE_HIDDEN',
  'DISCARD',
  'MILL',
  'SHUFFLE',
  'PEEK',
  'SEARCH',
  'TAP',
  'UNTAP',
  'COUNTER',
  'LIFE',
  'CMD_DAMAGE',
  'DICE',
  'TOKEN',
  'SYSTEM',
] as const;
export type LogType = (typeof LOG_TYPES)[number];

/** Tipos de log que NUNCA podem carregar identidade de carta. */
export const NEUTRAL_LOG_TYPES: ReadonlySet<LogType> = new Set<LogType>([
  'DRAW',
  'ZONE_CHANGE_HIDDEN',
  'MILL',
  'SHUFFLE',
  'PEEK',
  'SEARCH',
]);

export interface LogEvent {
  id: string;
  timestamp: number;
  type: LogType;
  actorId: string;
  /**
   * Texto neutro. Pode conter o marcador `{Carta}`, que o cliente substitui
   * pelo nome resolvido a partir de `scryfallId`.
   */
  text: string;
  /**
   * Identidade da carta envolvida — PRESENTE APENAS em acao publica.
   *
   * O servidor nao guarda nome de carta (DOC-030 §1.2): guarda o id. Sem este
   * campo, o log dizia "moveu uma carta" ate entre duas zonas publicas, onde
   * nomear e permitido e esperado — e o historico da partida ficava ilegivel.
   *
   * NUNCA acompanha um `LogType` neutro (`NEUTRAL_LOG_TYPES`): esses cobrem
   * exatamente as acoes em zona oculta, e um id ali seria vazamento (RN09).
   */
  scryfallId?: string;
}

export interface ChatEvent {
  id: string;
  timestamp: number;
  actorId: string;
  text: string;
}

export interface DiceEvent {
  actorId: string;
  sides: DiceSides;
  result: number;
}

export interface PingEvent {
  actorId: string;
  x: number;
  y: number;
  targetId?: string;
}

/**
 * Resultado de "olhar o topo". Enviado SO ao dono, por `client.send()`.
 * Um `broadcast` aqui e um vazamento de informacao oculta.
 */
export interface RevealToOwnerEvent {
  cards: Array<{ id: string; scryfallId: string }>;
}

/**
 * Abertura de um scry/surveil. Vai SO ao dono (`client.send`): as cartas do
 * topo do grimorio sao informacao oculta ate a decisao ser tomada.
 */
export interface ScryOpenedEvent {
  mode: 'SCRY' | 'SURVEIL';
  cards: Array<{ id: string; scryfallId: string }>;
}

export interface WarningEvent {
  code: 'RATE_LIMITED' | 'PEEK_EXPIRED' | 'RECONNECTING';
  message: string;
}

export interface ErrorEvent {
  code: IntentError | HandshakeError;
  message: string;
  intent?: IntentType;
}

export interface PlayerPresenceEvent {
  playerId: string;
  name: string;
}

export interface PlayerConnectionEvent {
  playerId: string;
}

/** A sala saiu de WAITING: os clientes fecham a sala de espera. */
export interface MatchStartedEvent {
  startedBy: string;
}

export interface RoomClosingEvent {
  reason: 'EMPTY' | 'DRAIN_FOR_DEPLOY' | 'ERROR' | 'ALL_LEFT';
  inSeconds: number;
}

/** Mapa canonico: nome do evento -> payload. */
export interface ServerEventMap {
  log: LogEvent;
  chat: ChatEvent;
  dice: DiceEvent;
  ping: PingEvent;
  revealToOwner: RevealToOwnerEvent;
  scryOpened: ScryOpenedEvent;
  warning: WarningEvent;
  error: ErrorEvent;
  playerJoined: PlayerPresenceEvent;
  playerLeft: PlayerPresenceEvent;
  playerDisconnected: PlayerConnectionEvent;
  playerReconnected: PlayerConnectionEvent;
  matchStarted: MatchStartedEvent;
  roomClosing: RoomClosingEvent;
}

export type ServerEventType = keyof ServerEventMap;
export type ServerEventPayload<T extends ServerEventType> = ServerEventMap[T];
