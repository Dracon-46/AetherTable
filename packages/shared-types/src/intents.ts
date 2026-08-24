/**
 * Contrato CLIENTE -> SERVIDOR.
 *
 * O cliente envia APENAS intencoes. Nunca estado. Essa assimetria e a espinha
 * dorsal de RN07: o cliente pede, o servidor decide.
 *
 * Fonte canonica do contrato de rede: docs/especificacao_websocket_e_eventos.md §3.
 * Fonte canonica da lista de acoes de mesa: docs/catalogo_de_acoes_da_mesa.md.
 *
 * NOTA DE NOMENCLATURA: `INTENT_SHUFFLE_ZONE` era alias de `INTENT_SHUFFLE`.
 * DOC-031 §3.7.1 manda remover o alias antes do primeiro release — feito: aqui
 * existe apenas `INTENT_SHUFFLE`.
 */

import type { Zone } from './zones';
import type { DayNight, Designation, PlayerCounter } from './player';

// ─── Movimento e posicionamento (DOC-031 §3.1) ───────────────────────────────

export interface GrabPayload {
  entityId: string;
}
export interface MoveCardPayload {
  entityId: string;
  x: number;
  y: number;
}
export interface ReleasePayload {
  entityId: string;
  x: number;
  y: number;
  zIndex?: number;
}
export interface BringToFrontPayload {
  entityId: string;
}

// ─── Zona e grimorio (DOC-031 §3.2) ──────────────────────────────────────────

export interface ChangeZonePayload {
  entityId: string;
  targetZone: Zone;
  index?: number;
  x?: number;
  y?: number;
}
export interface DrawPayload {
  amount: number;
}
export interface MillPayload {
  amount: number;
  target: 'GRAVEYARD' | 'EXILE';
}
export interface MoveTopToBottomPayload {
  amount: number;
}
export interface ShufflePayload {
  zone: Zone;
  keepTop?: number;
}
export type MulliganPayload = Record<string, never>;
export interface DrawUpToPayload {
  target: number;
}
export interface ReturnZonePayload {
  from: Zone;
  to: Zone;
  shuffle: boolean;
}
export interface ReorderPayload {
  zone: Zone;
  ids: string[];
}

// ─── Visibilidade (DOC-031 §3.2.1) — a familia mais sensivel ─────────────────
//
// INVARIANTE: nao existe intencao para olhar zona oculta ALHEIA. O vocabulario
// do protocolo nao tem essa frase — e o que torna a trapaca inexprimivel, nao
// apenas proibida.

export interface PeekPayload {
  zone: Extract<Zone, 'LIBRARY' | 'GRAVEYARD' | 'EXILE'>;
  amount: number;
  from?: 'TOP' | 'BOTTOM';
}
export type ClosePeekPayload = Record<string, never>;
export interface ScryPayload {
  amount: number;
}
export interface ScryCommitPayload {
  toBottom: string[];
  topOrder: string[];
}
export interface SurveilPayload {
  amount: number;
}
export interface SurveilCommitPayload {
  toGraveyard: string[];
  topOrder: string[];
}
export interface SearchZonePayload {
  zone: Zone;
  filter?: string;
}
/** `to`: 'ALL' ou lista de sessionIds. */
export type RevealTarget = 'ALL' | string[];
export interface RevealPayload {
  ids: string[];
  to: RevealTarget;
}
export interface RevealZonePayload {
  zone: Zone;
  to: RevealTarget;
}
export interface RevealTopPayload {
  amount: number;
}
export interface UnrevealPayload {
  ids: string[];
}
export interface SetZoneVisibilityPayload {
  zone: Zone;
  to: RevealTarget;
}

// ─── Propriedades de carta (DOC-031 §3.3) ────────────────────────────────────

export interface TapPayload {
  entityId: string;
  isTapped: boolean;
}
export type TapAllPayload = Record<string, never>;
export type UntapAllPayload = Record<string, never>;
export type CardBooleanProperty = 'isTapped' | 'faceDown';
export interface UpdatePropertyPayload {
  entityId: string;
  property: CardBooleanProperty | 'rotation';
  value: boolean | number;
}
export interface TransformPayload {
  entityId: string;
}
export interface MeldPayload {
  ids: [string, string];
  resultScryfallId: string;
}
export interface AttachPayload {
  childId: string;
  parentId: string;
}
export interface DetachPayload {
  childId: string;
}
export interface GroupPayload {
  ids: string[];
}
export interface SetPtPayload {
  entityId: string;
  power: number;
  toughness: number;
}
export interface SetDamagePayload {
  entityId: string;
  amount: number;
}
export type ClearDamagePayload = Record<string, never>;
export interface SetNotePayload {
  entityId: string;
  text: string;
}
export interface SetHighlightPayload {
  entityId: string;
  color: string;
}
export interface SetControllerPayload {
  entityId: string;
  controllerId: string;
}
/** Uma mensagem para selecao multipla (F25) — evita estourar o limite de 30/s. */
export interface BatchUpdatePayload {
  entityIds: string[];
  property: CardBooleanProperty | 'rotation';
  value: boolean | number;
}
export interface SetCommanderPayload {
  entityId: string;
}

// ─── Contadores (DOC-031 §3.3.1) ─────────────────────────────────────────────

export interface AddCounterPayload {
  entityId: string;
  /** Chave livre validada por COUNTER_NAME_PATTERN. `amount` pode ser negativo. */
  name: string;
  amount: number;
}
export interface SetCounterPayload {
  entityId: string;
  name: string;
  /** Valor absoluto. Remove a chave se 0. */
  value: number;
}
export interface ClearCountersPayload {
  entityId: string;
}
export interface AddPlayerCounterPayload {
  name: string;
  amount: number;
}
export interface BatchCounterPayload {
  entityIds: string[];
  name: string;
  amount: number;
}

// ─── Jogador e designacoes (DOC-031 §3.4) ────────────────────────────────────

export type SetLifePayload = { delta: number } | { absolute: number };
export interface SetCommanderDamagePayload {
  fromPlayerId: string;
  delta: number;
}
export interface SetPlayerCounterPayload {
  type: PlayerCounter;
  delta: number;
}
export interface ToggleDesignationPayload {
  type: Designation;
}
export interface SetCommanderTaxPayload {
  delta: number;
}
export interface SetRingPayload {
  /** 0..4 — "O Anel te tenta". */
  level: number;
  bearerId?: string;
}
export interface SetDayNightPayload {
  value: DayNight;
}
export interface SetSpeedPayload {
  /** 0..4 — "Start your engines!". */
  value: number;
}
export interface VenturePayload {
  dungeon: string;
  room: string;
}
export interface SetMaxHandSizePayload {
  value: number;
}
export interface SetTurnOrderPayload {
  order: string[];
}
/** Marca o jogador como eliminado. NAO o remove da sala (RN01). */
export type ConcedePayload = Record<string, never>;

// ─── Objetos criados (DOC-031 §3.5) ──────────────────────────────────────────

export interface CreateTokenPayload {
  scryfallId?: string;
  name?: string;
  power?: number;
  toughness?: number;
  colors?: string[];
  amount: number;
  x: number;
  y: number;
}
export interface CopyCardPayload {
  entityId: string;
}
export interface DestroyTokenPayload {
  entityId: string;
}
export type ClearTokensPayload = Record<string, never>;
export interface CreateEmblemPayload {
  scryfallId: string;
}

// ─── Aleatoriedade (DOC-031 §3.6) — tudo via crypto.randomInt (RN06) ─────────

export const DICE_SIDES = [2, 4, 6, 8, 10, 12, 20, 100] as const;
export type DiceSides = (typeof DICE_SIDES)[number];

export interface RollDicePayload {
  sides: DiceSides;
}
export type FlipCoinPayload = Record<string, never>;
export type RandomPlayerPayload = Record<string, never>;
export interface RandomCardPayload {
  zone: Zone;
  filter?: string;
}
export interface DiscardRandomPayload {
  amount: number;
}
export type DiscardAllPayload = Record<string, never>;
export type PlaneswalkPayload = Record<string, never>;
export type DrawSchemePayload = Record<string, never>;

// ─── Mesa e comunicacao (DOC-031 §3.6) ───────────────────────────────────────

export interface ChatPayload {
  /** Max. 500 caracteres. Sanitizado no servidor. Nao persistido (RN11). */
  text: string;
}
export interface PingPayload {
  x: number;
  y: number;
  targetId?: string;
}
/**
 * Seta de alvo persistente — e como se diz "isto ataca aquilo" sem motor de
 * regras (DOC-036 §11.1).
 */
export interface ArrowPayload {
  fromId: string;
  toId: string;
  color?: string;
}
export interface ClearArrowsPayload {
  scope: 'MINE' | 'COMBAT';
}
export interface SetTurnPayload {
  turn?: number;
  phase?: string;
}
export type PassTurnPayload = Record<string, never>;
/**
 * Desfaz a ULTIMA acao propria, janela de 10 s. NAO desfaz acao aleatoria nem
 * revelacao — seria nova tentativa (DOC-036 §11.3).
 */
export type UndoPayload = Record<string, never>;

// ─── Ciclo e formato (DOC-031 §3.7) ──────────────────────────────────────────

/** Requer confirmacao de todos os presentes. */
export type ResetMatchPayload = Record<string, never>;
export type LeavePayload = Record<string, never>;
export interface FetchFromSideboardPayload {
  scryfallId: string;
  to: Zone;
}
/** COMMAND -> BATTLEFIELD e incrementa `commanderTax` em 2. */
export interface CastCommanderPayload {
  entityId: string;
}

// ─── Mapa canonico: nome da intencao -> payload ──────────────────────────────

export interface IntentPayloadMap {
  // movimento
  INTENT_GRAB: GrabPayload;
  INTENT_MOVE_CARD: MoveCardPayload;
  INTENT_RELEASE: ReleasePayload;
  INTENT_BRING_TO_FRONT: BringToFrontPayload;
  // zona e grimorio
  INTENT_CHANGE_ZONE: ChangeZonePayload;
  INTENT_DRAW: DrawPayload;
  INTENT_MILL: MillPayload;
  INTENT_MOVE_TOP_TO_BOTTOM: MoveTopToBottomPayload;
  INTENT_SHUFFLE: ShufflePayload;
  INTENT_MULLIGAN: MulliganPayload;
  INTENT_DRAW_UP_TO: DrawUpToPayload;
  INTENT_RETURN_ZONE: ReturnZonePayload;
  INTENT_REORDER: ReorderPayload;
  // visibilidade
  INTENT_PEEK: PeekPayload;
  INTENT_CLOSE_PEEK: ClosePeekPayload;
  INTENT_SCRY: ScryPayload;
  INTENT_SCRY_COMMIT: ScryCommitPayload;
  INTENT_SURVEIL: SurveilPayload;
  INTENT_SURVEIL_COMMIT: SurveilCommitPayload;
  INTENT_SEARCH_ZONE: SearchZonePayload;
  INTENT_REVEAL: RevealPayload;
  INTENT_REVEAL_ZONE: RevealZonePayload;
  INTENT_REVEAL_TOP: RevealTopPayload;
  INTENT_UNREVEAL: UnrevealPayload;
  INTENT_SET_ZONE_VISIBILITY: SetZoneVisibilityPayload;
  // propriedades de carta
  INTENT_TAP: TapPayload;
  INTENT_TAP_ALL: TapAllPayload;
  INTENT_UNTAP_ALL: UntapAllPayload;
  INTENT_UPDATE_PROPERTY: UpdatePropertyPayload;
  INTENT_TRANSFORM: TransformPayload;
  INTENT_MELD: MeldPayload;
  INTENT_ATTACH: AttachPayload;
  INTENT_DETACH: DetachPayload;
  INTENT_GROUP: GroupPayload;
  INTENT_SET_PT: SetPtPayload;
  INTENT_SET_DAMAGE: SetDamagePayload;
  INTENT_CLEAR_DAMAGE: ClearDamagePayload;
  INTENT_SET_NOTE: SetNotePayload;
  INTENT_SET_HIGHLIGHT: SetHighlightPayload;
  INTENT_SET_CONTROLLER: SetControllerPayload;
  INTENT_BATCH_UPDATE: BatchUpdatePayload;
  INTENT_SET_COMMANDER: SetCommanderPayload;
  // contadores
  INTENT_ADD_COUNTER: AddCounterPayload;
  INTENT_SET_COUNTER: SetCounterPayload;
  INTENT_CLEAR_COUNTERS: ClearCountersPayload;
  INTENT_ADD_PLAYER_COUNTER: AddPlayerCounterPayload;
  INTENT_BATCH_COUNTER: BatchCounterPayload;
  // jogador e designacoes
  INTENT_SET_LIFE: SetLifePayload;
  INTENT_SET_COMMANDER_DAMAGE: SetCommanderDamagePayload;
  INTENT_SET_PLAYER_COUNTER: SetPlayerCounterPayload;
  INTENT_TOGGLE_DESIGNATION: ToggleDesignationPayload;
  INTENT_SET_COMMANDER_TAX: SetCommanderTaxPayload;
  INTENT_SET_RING: SetRingPayload;
  INTENT_SET_DAY_NIGHT: SetDayNightPayload;
  INTENT_SET_SPEED: SetSpeedPayload;
  INTENT_VENTURE: VenturePayload;
  INTENT_SET_MAX_HAND_SIZE: SetMaxHandSizePayload;
  INTENT_SET_TURN_ORDER: SetTurnOrderPayload;
  INTENT_CONCEDE: ConcedePayload;
  // objetos criados
  INTENT_CREATE_TOKEN: CreateTokenPayload;
  INTENT_COPY_CARD: CopyCardPayload;
  INTENT_DESTROY_TOKEN: DestroyTokenPayload;
  INTENT_CLEAR_TOKENS: ClearTokensPayload;
  INTENT_CREATE_EMBLEM: CreateEmblemPayload;
  // aleatoriedade
  INTENT_ROLL_DICE: RollDicePayload;
  INTENT_FLIP_COIN: FlipCoinPayload;
  INTENT_RANDOM_PLAYER: RandomPlayerPayload;
  INTENT_RANDOM_CARD: RandomCardPayload;
  INTENT_DISCARD_RANDOM: DiscardRandomPayload;
  INTENT_DISCARD_ALL: DiscardAllPayload;
  INTENT_PLANESWALK: PlaneswalkPayload;
  INTENT_DRAW_SCHEME: DrawSchemePayload;
  // mesa e comunicacao
  INTENT_CHAT: ChatPayload;
  INTENT_PING: PingPayload;
  INTENT_ARROW: ArrowPayload;
  INTENT_CLEAR_ARROWS: ClearArrowsPayload;
  INTENT_SET_TURN: SetTurnPayload;
  INTENT_PASS_TURN: PassTurnPayload;
  INTENT_UNDO: UndoPayload;
  // ciclo e formato
  INTENT_RESET_MATCH: ResetMatchPayload;
  INTENT_LEAVE: LeavePayload;
  INTENT_FETCH_FROM_SIDEBOARD: FetchFromSideboardPayload;
  INTENT_CAST_COMMANDER: CastCommanderPayload;
}

export type IntentType = keyof IntentPayloadMap;
export type IntentPayload<T extends IntentType> = IntentPayloadMap[T];

/** Codigos de rejeicao devolvidos em `error`. DOC-031 §6. */
export const INTENT_ERRORS = [
  'INVALID_PAYLOAD',
  'ENTITY_NOT_FOUND',
  'NOT_AUTHORIZED',
  'RATE_LIMITED',
  'ZONE_NOT_ALLOWED',
  'INTERNAL',
] as const;
export type IntentError = (typeof INTENT_ERRORS)[number];
