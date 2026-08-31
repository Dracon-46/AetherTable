import { MapSchema, Schema, type } from '@colyseus/schema';
import { Arrow } from './Arrow';
import { Card } from './Card';
import { Player } from './Player';
import { ZoneOrderList } from './ZoneOrderList';

/**
 * Estado autoritativo da sala.
 *
 * Vive na RAM do game node. NUNCA no Postgres (ADR-006, RN12): muta dezenas de
 * vezes por segundo e nao tem valor depois da partida.
 *
 * Fonte canonica: docs/especificacao_do_motor_sandbox.md §3.
 */
export class RoomState extends Schema {
  @type('string') roomCode!: string;
  /** WAITING | PLAYING | PAUSED | CLOSING */
  @type('string') phase = 'WAITING';
  /** Marcador VISUAL apenas (F29). O motor nao controla turnos. */
  @type('number') turn = 1;
  /** Marcador VISUAL apenas. */
  @type('string') activePlayerId = '';
  @type('number') startedAt = 0;

  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Card }) cards = new MapSchema<Card>();

  /**
   * Ordem por zona: `zoneOrder["p1:LIBRARY"] = [cardId, ...]`.
   *
   * Separado das cartas de proposito: HAND, LIBRARY, GRAVEYARD e EXILE sao
   * ordenadas, e guardar a ordem como indice dentro de `Card` obrigaria a
   * reindexar N cartas a cada insercao — N patches para uma unica compra.
   *
   * SEGURANCA: contem IDs DE MESA (`Card.id`), nunca `scryfallId`. Conhecer a
   * ordem dos UUIDs de um grimorio nao revela nada: os UUIDs sao gerados por
   * partida e nao tem relacao com a identidade da carta (DOC-032 §3.1).
   */
  @type({ map: ZoneOrderList }) zoneOrder = new MapSchema<ZoneOrderList>();

  /**
   * Campos da SALA DE ESPERA. Vivem no estado (e nao na querystring do
   * /play/:code) porque quem entra pelo codigo nunca recebeu essas opcoes:
   * so o criador as tinha na URL, e o lobby dele mostrava dados que o
   * convidado nao via.
   *
   * ATENCAO: campos novos vao no FIM. O @colyseus/schema serializa por INDICE
   * — inserir no meio desloca todos os seguintes e o mirror do cliente decodifica
   * lixo. Foi exatamente esse o defeito de `Player.mulliganCount`.
   */
  @type('number') maxSeats = 4;
  /** COMMANDER | STANDARD | MODERN | PAUPER ... */
  @type('string') gameType = 'COMMANDER';

  /** DAY | NIGHT | NEITHER (DOC-036 item 110). Marcador visual. */
  @type('string') dayNight = 'NEITHER';
  /** Rotulo livre de fase, escrito por INTENT_SET_TURN (DOC-036 item 127). */
  @type('string') turnPhase = '';
  /** Setas de alvo persistentes (DOC-036 item 126). */
  @type({ map: Arrow }) arrows = new MapSchema<Arrow>();
}
