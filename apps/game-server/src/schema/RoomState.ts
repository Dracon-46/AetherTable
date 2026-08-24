import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema';
import { Card } from './Card';
import { Player } from './Player';

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
  @type({ map: ['string'] }) zoneOrder = new MapSchema<ArraySchema<string>>();
}
