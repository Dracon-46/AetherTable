import type { ICard } from './card';
import type { IPlayer } from './player';

export const ROOM_PHASES = ['WAITING', 'PLAYING', 'PAUSED', 'CLOSING'] as const;
export type RoomPhase = (typeof ROOM_PHASES)[number];

/**
 * Estado autoritativo da sala. Vive na RAM do game node — nunca no Postgres
 * (ADR-006, RN12). Fonte canonica: docs/especificacao_do_motor_sandbox.md §3.
 */
export interface IRoomState {
  roomCode: string;
  phase: RoomPhase;
  /** Marcador VISUAL apenas (F29). O motor nao controla turnos. */
  turn: number;
  /** Marcador VISUAL apenas. */
  activePlayerId: string;
  startedAt: number;

  players: Record<string, IPlayer>;
  cards: Record<string, ICard>;

  /**
   * Ordem por zona: `zoneOrder["p1:LIBRARY"] = [cardId, ...]`.
   * Contem IDs DE MESA, nunca `scryfallId` (DOC-032 §3.1).
   */
  zoneOrder: Record<string, string[]>;
}

/** Nome do room handler registrado no Colyseus. */
export const AETHER_ROOM = 'aether_room';

/** Opcoes enviadas no `joinById` — validadas em `onAuth` (FR-20). */
export interface JoinOptions {
  /** JWT de assento emitido pela API Core. Expira em 60 s, uso unico. */
  seatToken: string;
  deckId: string;
}

/** Rejeicoes possiveis no handshake. DOC-031 §2.1. */
export const HANDSHAKE_ERRORS = [
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'TOKEN_ALREADY_USED',
  'ROOM_FULL',
  'ROOM_CLOSED',
  'PLAYER_BLOCKED',
] as const;
export type HandshakeError = (typeof HANDSHAKE_ERRORS)[number];

/** Parametros do canal de tempo real. DOC-031 §2.2. */
export const REALTIME_LIMITS = {
  /** Taxa de envio de patches, em ms (20 Hz). */
  PATCH_RATE_MS: 50,
  HEARTBEAT_MS: 15_000,
  CONNECTION_TIMEOUT_MS: 45_000,
  /** Janela de reconexao, em segundos (RN10). */
  RECONNECTION_WINDOW_S: 90,
  /** Intencoes por segundo, por cliente. Excedente e descartado com `warning`. */
  MAX_INTENTS_PER_SECOND: 30,
  /** Intencoes sao pequenas por natureza. Acima disto, fecha a conexao. */
  MAX_MESSAGE_BYTES: 4096,
  /** TTL do lock de arraste, em ms (FR-10). */
  DRAG_LOCK_TTL_MS: 5_000,
  /** Throttle do cliente durante o arraste. */
  CLIENT_DRAG_THROTTLE_PER_SECOND: 20,
  /** Validade do peekBuffer. Buffer eterno travaria o grimorio. */
  PEEK_TIMEOUT_MS: 120_000,
  /** Janela do INTENT_UNDO. */
  UNDO_WINDOW_MS: 10_000,
  MAX_PLAYERS: 4,
} as const;
