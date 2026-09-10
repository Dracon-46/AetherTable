/**
 * intents.ts — Emissores tipados de intenções para o Game Server (DOC-031 §3).
 *
 * O cliente NUNCA envia estado — apenas intenções.
 * Throttle de 20/s em INTENT_MOVE_CARD (DOC-040 §5).
 */

import type { Room } from 'colyseus.js';
import type { SetRoomConfigPayload } from '@aethertable/shared-types';

let moveCardLastSent = 0;
const MOVE_THROTTLE_MS = 50; // 20/s

export function sendIntent(room: Room, type: string, payload?: object) {
  room.send(type, payload ?? {});
}

// ─── Movimento ─────────────────────────────────────────────────────────────

export const intents = {
  grab: (room: Room, entityId: string) => sendIntent(room, 'INTENT_GRAB', { entityId }),

  moveCard: (room: Room, entityId: string, x: number, y: number) => {
    const now = Date.now();
    if (now - moveCardLastSent < MOVE_THROTTLE_MS) return;
    moveCardLastSent = now;
    sendIntent(room, 'INTENT_MOVE_CARD', { entityId, x, y });
  },

  release: (room: Room, entityId: string, x: number, y: number, zIndex?: number) =>
    sendIntent(room, 'INTENT_RELEASE', {
      entityId,
      x,
      y,
      ...(zIndex !== undefined ? { zIndex } : {}),
    }),

  changeZone: (
    room: Room,
    entityId: string,
    targetZone: string,
    x?: number,
    y?: number,
    index?: number,
  ) => sendIntent(room, 'INTENT_CHANGE_ZONE', { entityId, targetZone, x, y, index }),

  bringToFront: (room: Room, entityId: string) =>
    sendIntent(room, 'INTENT_BRING_TO_FRONT', { entityId }),

  // ─── Grimório ─────────────────────────────────────────────────────────────

  draw: (room: Room, amount = 1) => sendIntent(room, 'INTENT_DRAW', { amount }),

  shuffle: (room: Room, zone = 'LIBRARY', keepTop?: number) =>
    sendIntent(room, 'INTENT_SHUFFLE', { zone, ...(keepTop ? { keepTop } : {}) }),

  peek: (room: Room, zone: string, amount: number, from: 'TOP' | 'BOTTOM' = 'TOP') =>
    sendIntent(room, 'INTENT_PEEK', { zone, amount, from }),

  closePeek: (room: Room) => sendIntent(room, 'INTENT_CLOSE_PEEK'),

  mill: (
    room: Room,
    amount: number,
    target: 'GRAVEYARD' | 'EXILE' = 'GRAVEYARD',
    /** Só vale no exílio: no cemitério a carta é pública por definição. */
    faceDown = false,
  ) => sendIntent(room, 'INTENT_MILL', { amount, target, faceDown }),

  mulligan: (room: Room) => sendIntent(room, 'INTENT_MULLIGAN'),

  untapAll: (room: Room) => sendIntent(room, 'INTENT_UNTAP_ALL'),

  tapAll: (room: Room) => sendIntent(room, 'INTENT_TAP_ALL'),

  // ─── Grimório (DOC-036 §2) ────────────────────────────────────────────────

  drawUpTo: (room: Room, target: number) => sendIntent(room, 'INTENT_DRAW_UP_TO', { target }),

  moveTopToBottom: (room: Room, amount: number) =>
    sendIntent(room, 'INTENT_MOVE_TOP_TO_BOTTOM', { amount }),

  /** Abre a zona inteira para o dono (tutor). `closePeek` revoga. */
  searchZone: (room: Room, zone: string, filter?: string) =>
    sendIntent(room, 'INTENT_SEARCH_ZONE', { zone, ...(filter ? { filter } : {}) }),

  returnZone: (room: Room, from: string, to = 'LIBRARY', shuffle = true) =>
    sendIntent(room, 'INTENT_RETURN_ZONE', { from, to, shuffle }),

  reorder: (room: Room, zone: string, ids: string[]) =>
    sendIntent(room, 'INTENT_REORDER', { zone, ids }),

  /** Scry e surveil são TRANSAÇÕES: abre, decide, confirma. */
  scry: (room: Room, amount: number) => sendIntent(room, 'INTENT_SCRY', { amount }),

  scryCommit: (room: Room, toBottom: string[], topOrder: string[]) =>
    sendIntent(room, 'INTENT_SCRY_COMMIT', { toBottom, topOrder }),

  surveil: (room: Room, amount: number) => sendIntent(room, 'INTENT_SURVEIL', { amount }),

  surveilCommit: (room: Room, toGraveyard: string[], topOrder: string[]) =>
    sendIntent(room, 'INTENT_SURVEIL_COMMIT', { toGraveyard, topOrder }),

  // ─── Revelação (DOC-036 §3) ───────────────────────────────────────────────

  reveal: (room: Room, ids: string[], to: 'ALL' | string[] = 'ALL') =>
    sendIntent(room, 'INTENT_REVEAL', { ids, to }),

  revealZone: (room: Room, zone: string, to: 'ALL' | string[] = 'ALL') =>
    sendIntent(room, 'INTENT_REVEAL_ZONE', { zone, to }),

  revealTop: (room: Room, amount = 1) => sendIntent(room, 'INTENT_REVEAL_TOP', { amount }),

  /**
   * Liga/desliga o modo "jogar com o topo do grimório revelado".
   *
   * É modo, e não ação: quem reaplica a revelação a cada mudança de topo é o
   * servidor, num ponto só. O cliente não teria como — `moveTopToBottom`,
   * `reorder` e os commits de scry/surveil mudam a ordem sem mudar de zona.
   */
  setTopRevealed: (room: Room, ligado: boolean) =>
    sendIntent(room, 'INTENT_SET_TOP_REVEALED', { ligado }),

  unreveal: (room: Room, ids: string[]) => sendIntent(room, 'INTENT_UNREVEAL', { ids }),

  setZoneVisibility: (room: Room, zone: string, to: 'ALL' | string[]) =>
    sendIntent(room, 'INTENT_SET_ZONE_VISIBILITY', { zone, to }),

  // ─── Descarte (DOC-036 §3) ────────────────────────────────────────────────

  discardRandom: (room: Room, amount = 1) => sendIntent(room, 'INTENT_DISCARD_RANDOM', { amount }),

  discardAll: (room: Room) => sendIntent(room, 'INTENT_DISCARD_ALL'),

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

  transform: (room: Room, entityId: string) => sendIntent(room, 'INTENT_TRANSFORM', { entityId }),

  attach: (room: Room, childId: string, parentId: string) =>
    sendIntent(room, 'INTENT_ATTACH', { childId, parentId }),

  detach: (room: Room, childId: string) => sendIntent(room, 'INTENT_DETACH', { childId }),

  setPt: (room: Room, entityId: string, power: number, toughness: number, active = true) =>
    sendIntent(room, 'INTENT_SET_PT', { entityId, power, toughness, active }),

  setDamage: (room: Room, entityId: string, amount: number) =>
    sendIntent(room, 'INTENT_SET_DAMAGE', { entityId, amount }),

  /**
   * Soma dano. Use este nos botões de +1/−1.
   *
   * `setDamage` manda o TOTAL, e o total só pode ser calculado a partir do
   * último valor recebido do servidor — três cliques rápidos leem a mesma base
   * e mandam "1, 1, 1". Delta não depende do que o cliente sabe.
   */
  addDamage: (room: Room, entityId: string, delta: number) =>
    sendIntent(room, 'INTENT_ADD_DAMAGE', { entityId, delta }),

  clearDamage: (room: Room) => sendIntent(room, 'INTENT_CLEAR_DAMAGE'),

  setCommander: (room: Room, entityId: string) =>
    sendIntent(room, 'INTENT_SET_COMMANDER', { entityId }),

  /** Uma mensagem para a seleção inteira — N mensagens estourariam 30/s. */
  batchUpdate: (
    room: Room,
    entityIds: string[],
    property: 'isTapped' | 'faceDown' | 'rotation' | 'phasedOut' | 'enteredThisTurn',
    value: boolean | number,
  ) => sendIntent(room, 'INTENT_BATCH_UPDATE', { entityIds, property, value }),

  batchCounter: (room: Room, entityIds: string[], name: string, amount: number) =>
    sendIntent(room, 'INTENT_BATCH_COUNTER', { entityIds, name, amount }),

  setFaceDown: (room: Room, entityId: string, faceDown: boolean) =>
    sendIntent(room, 'INTENT_UPDATE_PROPERTY', { entityId, property: 'faceDown', value: faceDown }),

  // ─── Tokens ───────────────────────────────────────────────────────────────

  createToken: (
    room: Room,
    payload: {
      scryfallId?: string;
      name?: string;
      power?: string;
      toughness?: string;
      amount?: number;
      x: number;
      y: number;
    },
  ) => sendIntent(room, 'INTENT_CREATE_TOKEN', { amount: 1, ...payload }),

  destroyToken: (room: Room, entityId: string) =>
    sendIntent(room, 'INTENT_DESTROY_TOKEN', { entityId }),

  // Cópia de permanente (Kiki-Jiki, clones, "copie a magia"). O handler já
  // existia no servidor desde a rodada 2, mas nenhuma tela emitia a intenção:
  // era a única ação implementada e inalcançável do catálogo.
  copyCard: (room: Room, entityId: string) => sendIntent(room, 'INTENT_COPY_CARD', { entityId }),

  clearTokens: (room: Room) => sendIntent(room, 'INTENT_CLEAR_TOKENS'),

  // ─── Jogador ──────────────────────────────────────────────────────────────

  setLife: (room: Room, delta?: number, absolute?: number) =>
    sendIntent(room, 'INTENT_SET_LIFE', delta !== undefined ? { delta } : { absolute }),

  setCommanderDamage: (room: Room, fromPlayerId: string, delta: number) =>
    sendIntent(room, 'INTENT_SET_COMMANDER_DAMAGE', { fromPlayerId, delta }),

  addPlayerCounter: (room: Room, name: string, amount: number) =>
    sendIntent(room, 'INTENT_ADD_PLAYER_COUNTER', { name, amount }),

  setPlayerCounter: (
    room: Room,
    type: 'POISON' | 'ENERGY' | 'EXPERIENCE' | 'RAD' | 'TICKET',
    delta: number,
  ) => sendIntent(room, 'INTENT_SET_PLAYER_COUNTER', { type, delta }),

  setCommanderTax: (room: Room, delta: number) =>
    sendIntent(room, 'INTENT_SET_COMMANDER_TAX', { delta }),

  setRing: (room: Room, level: number, bearerId?: string) =>
    sendIntent(room, 'INTENT_SET_RING', { level, ...(bearerId ? { bearerId } : {}) }),

  setDayNight: (room: Room, value: 'DAY' | 'NIGHT' | 'NEITHER') =>
    sendIntent(room, 'INTENT_SET_DAY_NIGHT', { value }),

  setSpeed: (room: Room, value: number) => sendIntent(room, 'INTENT_SET_SPEED', { value }),

  setMaxHandSize: (room: Room, value: number) =>
    sendIntent(room, 'INTENT_SET_MAX_HAND_SIZE', { value }),

  setTurnOrder: (room: Room, order: string[]) =>
    sendIntent(room, 'INTENT_SET_TURN_ORDER', { order }),

  /**
   * As regras da mesa, num envio só. O formulário manda só o que mudou — ver
   * `SetRoomConfigPayload` para por que não são cinco intenções.
   */
  setRoomConfig: (room: Room, config: SetRoomConfigPayload) =>
    sendIntent(room, 'INTENT_SET_ROOM_CONFIG', config),

  fetchFromSideboard: (room: Room, entityId: string, to = 'HAND') =>
    sendIntent(room, 'INTENT_FETCH_FROM_SIDEBOARD', { entityId, to }),

  toggleDesignation: (room: Room, type: 'MONARCH' | 'INITIATIVE') =>
    sendIntent(room, 'INTENT_TOGGLE_DESIGNATION', { type }),

  concede: (room: Room) => sendIntent(room, 'INTENT_CONCEDE'),

  castCommander: (room: Room, entityId: string) =>
    sendIntent(room, 'INTENT_CAST_COMMANDER', { entityId }),

  // ─── Aleatório e comunicação ──────────────────────────────────────────────

  rollDice: (room: Room, sides: number) => sendIntent(room, 'INTENT_ROLL_DICE', { sides }),

  flipCoin: (room: Room) => sendIntent(room, 'INTENT_FLIP_COIN'),

  randomPlayer: (room: Room) => sendIntent(room, 'INTENT_RANDOM_PLAYER'),

  randomCard: (room: Room, zone: string) => sendIntent(room, 'INTENT_RANDOM_CARD', { zone }),

  chat: (room: Room, text: string) => sendIntent(room, 'INTENT_CHAT', { text }),

  ping: (room: Room, x: number, y: number, targetId?: string) =>
    sendIntent(room, 'INTENT_PING', { x, y, ...(targetId ? { targetId } : {}) }),

  passTurn: (room: Room) => sendIntent(room, 'INTENT_PASS_TURN'),

  setTurn: (room: Room, turn?: number, phase?: string) =>
    sendIntent(room, 'INTENT_SET_TURN', {
      ...(turn !== undefined ? { turn } : {}),
      ...(phase !== undefined ? { phase } : {}),
    }),

  /** Seta de alvo: repetir o mesmo par origem/destino remove a seta. */
  arrow: (room: Room, fromId: string, toId: string, color?: string, combat = false) =>
    sendIntent(room, 'INTENT_ARROW', { fromId, toId, ...(color ? { color } : {}), combat }),

  clearArrows: (room: Room, scope: 'MINE' | 'COMBAT' = 'MINE') =>
    sendIntent(room, 'INTENT_CLEAR_ARROWS', { scope }),

  /** Desfaz a última ação própria reversível, janela de 10 s. */
  undo: (room: Room) => sendIntent(room, 'INTENT_UNDO'),

  /**
   * Equipa cosméticos. Só IDs do catálogo fechado — o servidor recusa
   * qualquer outro valor (DOC-060 §1.1).
   */
  setCosmetics: (
    room: Room,
    cosmeticos: Partial<{
      sleeveId: string;
      playmatId: string;
      borderId: string;
      titleId: string;
      petId: string;
    }>,
  ) => sendIntent(room, 'INTENT_SET_COSMETICS', cosmeticos),

  // ─── Sala de espera ───────────────────────────────────────────────────────

  /** Escolhe o grimório DENTRO da sala de espera. Substitui o anterior. */
  setDeck: (room: Room, deckId: string) => sendIntent(room, 'INTENT_SET_DECK', { deckId }),

  setReady: (room: Room, ready: boolean) => sendIntent(room, 'INTENT_SET_READY', { ready }),

  /** Só o anfitrião. O removido recebe `kicked` antes de a conexão cair. */
  kickPlayer: (room: Room, playerId: string) =>
    sendIntent(room, 'INTENT_KICK_PLAYER', { playerId }),

  /** Fecha a própria janela de mulligan. */
  keepHand: (room: Room) => sendIntent(room, 'INTENT_KEEP_HAND'),

  // ─── Ver a zona oculta de outro jogador, com consentimento (RN13) ─────────

  requestView: (room: Room, targetPlayerId: string, zone: string) =>
    sendIntent(room, 'INTENT_REQUEST_VIEW', { targetPlayerId, zone }),

  respondView: (room: Room, requesterId: string, zone: string, accept: boolean) =>
    sendIntent(room, 'INTENT_RESPOND_VIEW', { requesterId, zone, accept }),

  revokeView: (room: Room, viewerId: string, zone: string) =>
    sendIntent(room, 'INTENT_REVOKE_VIEW', { viewerId, zone }),

  /** Manda uma permanente própria para a MESA de outro jogador. */
  giveCard: (room: Room, entityId: string, targetPlayerId: string) =>
    sendIntent(room, 'INTENT_GIVE_CARD', { entityId, targetPlayerId }),

  /** Sai da fase WAITING e começa a partida. Só o anfitrião (assento 0). */
  startMatch: (room: Room) => sendIntent(room, 'INTENT_START_MATCH'),

  resetMatch: (room: Room) => sendIntent(room, 'INTENT_RESET_MATCH'),

  leave: (room: Room) => sendIntent(room, 'INTENT_LEAVE'),
};
