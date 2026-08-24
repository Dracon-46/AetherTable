/**
 * intents.ts — Emissores tipados de intenções para o Game Server (DOC-031 §3).
 *
 * O cliente NUNCA envia estado — apenas intenções.
 * Throttle de 20/s em INTENT_MOVE_CARD (DOC-040 §5).
 */

import type { Room } from 'colyseus.js';

let moveCardLastSent = 0;
const MOVE_THROTTLE_MS = 50; // 20/s

export function sendIntent(room: Room, type: string, payload?: object) {
  room.send(type, payload ?? {});
}

// ─── Movimento ─────────────────────────────────────────────────────────────

export const intents = {
  grab: (room: Room, entityId: string) =>
    sendIntent(room, 'INTENT_GRAB', { entityId }),

  moveCard: (room: Room, entityId: string, x: number, y: number) => {
    const now = Date.now();
    if (now - moveCardLastSent < MOVE_THROTTLE_MS) return;
    moveCardLastSent = now;
    sendIntent(room, 'INTENT_MOVE_CARD', { entityId, x, y });
  },

  release: (room: Room, entityId: string, x: number, y: number, zIndex?: number) =>
    sendIntent(room, 'INTENT_RELEASE', { entityId, x, y, ...(zIndex !== undefined ? { zIndex } : {}) }),

  changeZone: (room: Room, entityId: string, targetZone: string, x?: number, y?: number, index?: number) =>
    sendIntent(room, 'INTENT_CHANGE_ZONE', { entityId, targetZone, x, y, index }),

  bringToFront: (room: Room, entityId: string) =>
    sendIntent(room, 'INTENT_BRING_TO_FRONT', { entityId }),

  // ─── Grimório ─────────────────────────────────────────────────────────────

  draw: (room: Room, amount = 1) =>
    sendIntent(room, 'INTENT_DRAW', { amount }),

  shuffle: (room: Room, zone = 'LIBRARY') =>
    sendIntent(room, 'INTENT_SHUFFLE', { zone }),

  peek: (room: Room, zone: string, amount: number, from: 'TOP' | 'BOTTOM' = 'TOP') =>
    sendIntent(room, 'INTENT_PEEK', { zone, amount, from }),

  closePeek: (room: Room) =>
    sendIntent(room, 'INTENT_CLOSE_PEEK'),

  mill: (room: Room, amount: number, target: 'GRAVEYARD' | 'EXILE' = 'GRAVEYARD') =>
    sendIntent(room, 'INTENT_MILL', { amount, target }),

  mulligan: (room: Room) =>
    sendIntent(room, 'INTENT_MULLIGAN'),

  untapAll: (room: Room) =>
    sendIntent(room, 'INTENT_UNTAP_ALL'),

  // ─── Cartas ────────────────────────────────────────────────────────────────

  tap: (room: Room, entityId: string, isTapped: boolean) =>
    sendIntent(room, 'INTENT_TAP', { entityId, isTapped }),

  addCounter: (room: Room, entityId: string, name: string, amount: number) =>
    sendIntent(room, 'INTENT_ADD_COUNTER', { entityId, name, amount }),

  setCounter: (room: Room, entityId: string, name: string, value: number) =>
    sendIntent(room, 'INTENT_SET_COUNTER', { entityId, name, value }),

  clearCounters: (room: Room, entityId: string) =>
    sendIntent(room, 'INTENT_CLEAR_COUNTERS', { entityId }),

  setNote: (room: Room, entityId: string, text: string) =>
    sendIntent(room, 'INTENT_SET_NOTE', { entityId, text }),

  setHighlight: (room: Room, entityId: string, color: string) =>
    sendIntent(room, 'INTENT_SET_HIGHLIGHT', { entityId, color }),

  setController: (room: Room, entityId: string, controllerId: string) =>
    sendIntent(room, 'INTENT_SET_CONTROLLER', { entityId, controllerId }),

  transform: (room: Room, entityId: string) =>
    sendIntent(room, 'INTENT_TRANSFORM', { entityId }),

  setFaceDown: (room: Room, entityId: string, faceDown: boolean) =>
    sendIntent(room, 'INTENT_UPDATE_PROPERTY', { entityId, property: 'faceDown', value: faceDown }),

  // ─── Tokens ───────────────────────────────────────────────────────────────

  createToken: (room: Room, payload: { scryfallId?: string; name?: string; power?: string; toughness?: string; amount?: number; x: number; y: number }) =>
    sendIntent(room, 'INTENT_CREATE_TOKEN', { amount: 1, ...payload }),

  destroyToken: (room: Room, entityId: string) =>
    sendIntent(room, 'INTENT_DESTROY_TOKEN', { entityId }),

  clearTokens: (room: Room) =>
    sendIntent(room, 'INTENT_CLEAR_TOKENS'),

  // ─── Jogador ──────────────────────────────────────────────────────────────

  setLife: (room: Room, delta?: number, absolute?: number) =>
    sendIntent(room, 'INTENT_SET_LIFE', delta !== undefined ? { delta } : { absolute }),

  setCommanderDamage: (room: Room, fromPlayerId: string, delta: number) =>
    sendIntent(room, 'INTENT_SET_COMMANDER_DAMAGE', { fromPlayerId, delta }),

  addPlayerCounter: (room: Room, name: string, amount: number) =>
    sendIntent(room, 'INTENT_ADD_PLAYER_COUNTER', { name, amount }),

  toggleDesignation: (room: Room, type: 'MONARCH' | 'INITIATIVE') =>
    sendIntent(room, 'INTENT_TOGGLE_DESIGNATION', { type }),

  concede: (room: Room) =>
    sendIntent(room, 'INTENT_CONCEDE'),

  castCommander: (room: Room, entityId: string) =>
    sendIntent(room, 'INTENT_CAST_COMMANDER', { entityId }),

  // ─── Aleatório e comunicação ──────────────────────────────────────────────

  rollDice: (room: Room, sides: number) =>
    sendIntent(room, 'INTENT_ROLL_DICE', { sides }),

  flipCoin: (room: Room) =>
    sendIntent(room, 'INTENT_FLIP_COIN'),

  chat: (room: Room, text: string) =>
    sendIntent(room, 'INTENT_CHAT', { text }),

  ping: (room: Room, x: number, y: number, targetId?: string) =>
    sendIntent(room, 'INTENT_PING', { x, y, ...(targetId ? { targetId } : {}) }),

  passTurn: (room: Room) =>
    sendIntent(room, 'INTENT_PASS_TURN'),

  resetMatch: (room: Room) =>
    sendIntent(room, 'INTENT_RESET_MATCH'),

  leave: (room: Room) =>
    sendIntent(room, 'INTENT_LEAVE'),
};
