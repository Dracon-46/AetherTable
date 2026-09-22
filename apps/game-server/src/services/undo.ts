/**
 * undo.ts — o MEMENTO do padrao Command: o recorte de estado que um comando
 * guarda para conseguir se desfazer (DOC-036 item 130, RN: DOC-031).
 *
 * Quem decide QUANDO capturar e QUANDO restaurar e `intents/comandos.ts`; aqui
 * ficam o recorte, a janela e a lista do que nao volta atras.
 *
 * O QUE ESTE MODULO NAO FAZ, E POR QUE
 *
 * `INTENT_UNDO` desfaz a ULTIMA acao PROPRIA. Ele nao desfaz:
 *
 *   - acao aleatoria (embaralhar, sortear, dado, descarte aleatorio) — desfazer
 *     e refazer um sorteio e simplesmente uma segunda tentativa, o que e
 *     trapaca com passos extras;
 *   - revelacao e olhada — informacao vista nao volta a ser oculta; "desfazer"
 *     daria uma falsa sensacao de privacidade;
 *   - qualquer coisa que tenha tocado o estado de OUTRO jogador.
 *
 * Por isso o snapshot cobre exatamente o recorte que pertence ao jogador: as
 * cartas de que ele e dono, as listas de ordem das zonas dele e os marcadores
 * do proprio Player. Restaurar esse recorte e sempre seguro; restaurar mais que
 * isso deixaria de ser "desfazer" e viraria "reescrever a mesa".
 */

import type { RoomState } from '../schema/RoomState';
import { zoneOrderKey, ZONES, type Zone } from '@aethertable/shared-types';

/** Janela de arrependimento. Depois disto, a acao virou historia. */
export const JANELA_UNDO_MS = 10_000;

interface CartaSnapshot {
  zone: string;
  controllerId: string;
  x: number;
  y: number;
  rotation: number;
  zIndex: number;
  isTapped: boolean;
  faceDown: boolean;
  phasedOut: boolean;
  isFlipped: boolean;
  attachedTo: string;
  exiledBy: string;
  goadedBy: string;
  note: string;
  highlight: string;
  damage: number;
  powerOverride: number;
  toughnessOverride: number;
  hasPtOverride: boolean;
  enteredThisTurn: boolean;
  counters: Array<[string, number]>;
}

interface JogadorSnapshot {
  life: number;
  poison: number;
  energy: number;
  experience: number;
  rad: number;
  ticket: number;
  commanderTax: number;
  speed: number;
  ringLevel: number;
  ringBearerId: string;
  maxHandSize: number;
  isMonarch: boolean;
  hasInitiative: boolean;
  conceded: boolean;
  commanderDamage: Array<[string, number]>;
}

export interface Snapshot {
  sid: string;
  tipo: string;
  em: number;
  cartas: Array<[string, CartaSnapshot]>;
  zonas: Array<[Zone, string[]]>;
  jogador: JogadorSnapshot | null;
}

export function capturar(state: RoomState, sid: string, tipo: string): Snapshot {
  const cartas: Array<[string, CartaSnapshot]> = [];
  state.cards.forEach((c, id) => {
    if (c.ownerId !== sid && c.controllerId !== sid) return;
    cartas.push([
      id,
      {
        zone: c.zone,
        controllerId: c.controllerId,
        x: c.x,
        y: c.y,
        rotation: c.rotation,
        zIndex: c.zIndex,
        isTapped: c.isTapped,
        faceDown: c.faceDown,
        phasedOut: c.phasedOut,
        isFlipped: c.isFlipped,
        attachedTo: c.attachedTo,
        exiledBy: c.exiledBy,
        goadedBy: c.goadedBy,
        note: c.note,
        highlight: c.highlight,
        damage: c.damage,
        powerOverride: c.powerOverride,
        toughnessOverride: c.toughnessOverride,
        hasPtOverride: c.hasPtOverride,
        enteredThisTurn: c.enteredThisTurn,
        counters: Array.from(c.counters.entries()),
      },
    ]);
  });

  const zonas: Array<[Zone, string[]]> = [];
  for (const zona of ZONES) {
    const lista = state.zoneOrder.get(zoneOrderKey(sid, zona))?.items;
    if (lista) zonas.push([zona, Array.from(lista)]);
  }

  const p = state.players.get(sid);
  const jogador: JogadorSnapshot | null = p
    ? {
        life: p.life,
        poison: p.poison,
        energy: p.energy,
        experience: p.experience,
        rad: p.rad,
        ticket: p.ticket,
        commanderTax: p.commanderTax,
        speed: p.speed,
        ringLevel: p.ringLevel,
        ringBearerId: p.ringBearerId,
        maxHandSize: p.maxHandSize,
        isMonarch: p.isMonarch,
        hasInitiative: p.hasInitiative,
        conceded: p.conceded,
        commanderDamage: Array.from(p.commanderDamage.entries()),
      }
    : null;

  return { sid, tipo, em: Date.now(), cartas, zonas, jogador };
}

export function restaurar(state: RoomState, snap: Snapshot): void {
  for (const [id, s] of snap.cartas) {
    const c = state.cards.get(id);
    // A carta pode ter deixado de existir (token destruido): nada a restaurar.
    if (!c) continue;
    c.zone = s.zone;
    c.controllerId = s.controllerId;
    c.x = s.x;
    c.y = s.y;
    c.rotation = s.rotation;
    c.zIndex = s.zIndex;
    c.isTapped = s.isTapped;
    c.faceDown = s.faceDown;
    c.phasedOut = s.phasedOut;
    c.isFlipped = s.isFlipped;
    c.attachedTo = s.attachedTo;
    c.exiledBy = s.exiledBy;
    c.goadedBy = s.goadedBy;
    c.note = s.note;
    c.highlight = s.highlight;
    c.damage = s.damage;
    c.powerOverride = s.powerOverride;
    c.toughnessOverride = s.toughnessOverride;
    c.hasPtOverride = s.hasPtOverride;
    c.enteredThisTurn = s.enteredThisTurn;
    c.counters.clear();
    for (const [nome, valor] of s.counters) c.counters.set(nome, valor);
  }

  for (const [zona, ids] of snap.zonas) {
    const lista = state.zoneOrder.get(zoneOrderKey(snap.sid, zona))?.items;
    if (!lista) continue;
    lista.splice(0, lista.length, ...ids);
  }

  const p = state.players.get(snap.sid);
  if (p && snap.jogador) {
    const j = snap.jogador;
    p.life = j.life;
    p.poison = j.poison;
    p.energy = j.energy;
    p.experience = j.experience;
    p.rad = j.rad;
    p.ticket = j.ticket;
    p.commanderTax = j.commanderTax;
    p.speed = j.speed;
    p.ringLevel = j.ringLevel;
    p.ringBearerId = j.ringBearerId;
    p.maxHandSize = j.maxHandSize;
    p.isMonarch = j.isMonarch;
    p.hasInitiative = j.hasInitiative;
    p.conceded = j.conceded;
    p.commanderDamage.clear();
    for (const [de, valor] of j.commanderDamage) p.commanderDamage.set(de, valor);
    p.handCount = state.zoneOrder.get(zoneOrderKey(snap.sid, 'HAND'))?.items.length ?? p.handCount;
    p.libraryCount =
      state.zoneOrder.get(zoneOrderKey(snap.sid, 'LIBRARY'))?.items.length ?? p.libraryCount;
  }
}

/**
 * Intencoes que NAO entram no jornal. Ver o bloco de abertura: aleatoriedade e
 * revelacao nao sao reversiveis, e desfazer um `UNDO` seria um `REDO` que
 * ninguem pediu.
 */
export const NAO_REVERSIVEIS: ReadonlySet<string> = new Set([
  'INTENT_UNDO',
  'INTENT_SHUFFLE',
  'INTENT_MULLIGAN',
  'INTENT_ROLL_DICE',
  'INTENT_FLIP_COIN',
  'INTENT_RANDOM_PLAYER',
  'INTENT_RANDOM_CARD',
  'INTENT_DISCARD_RANDOM',
  'INTENT_PEEK',
  'INTENT_CLOSE_PEEK',
  'INTENT_SCRY',
  'INTENT_SURVEIL',
  'INTENT_SEARCH_ZONE',
  'INTENT_REVEAL',
  'INTENT_REVEAL_TOP',
  'INTENT_REVEAL_ZONE',
  'INTENT_UNREVEAL',
  'INTENT_SET_ZONE_VISIBILITY',
  'INTENT_CHAT',
  'INTENT_PING',
  'INTENT_START_MATCH',
  'INTENT_RESET_MATCH',
  'INTENT_LEAVE',
  // Trocar de sleeve nao e jogada: desfazer aqui so tiraria do jogador a
  // possibilidade de desfazer a jogada anterior de verdade.
  'INTENT_SET_COSMETICS',

  // ── Sala de espera e mesa social ────────────────────────────────────────

  /**
   * DESFAZER "fiquei com a mao" REABRIRIA O MULLIGAN.
   *
   * `keptHand` e justamente o que fecha a janela de mulligan. Um undo que o
   * reabrisse devolveria, por uma porta lateral, o "compre sete cartas novas a
   * qualquer momento" que a janela existe para tirar. E nem funcionaria: o
   * snapshot de jogador nao guarda `keptHand`, entao a acao so serviria para
   * consumir o slot e impedir o jogador de desfazer a jogada anterior de
   * verdade.
   */
  'INTENT_KEEP_HAND',

  /** Prontidao ja e um interruptor: "desfazer" e clicar de novo. */
  'INTENT_SET_READY',

  /** Nao da para trazer de volta quem ja foi desconectado. */
  'INTENT_KICK_PLAYER',

  /**
   * Mesma razao de REVEAL e PEEK: informacao vista nao volta a ser oculta.
   * Desfazer uma resposta de visualizacao daria a falsa sensacao de que o
   * observador "des-viu" a mao — e o jeito certo de fechar e revogar, que e
   * uma acao propria e explicita.
   */
  'INTENT_REQUEST_VIEW',
  'INTENT_RESPOND_VIEW',
  'INTENT_REVOKE_VIEW',
]);
