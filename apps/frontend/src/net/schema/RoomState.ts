//
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
//
// GENERATED USING @colyseus/schema 3.0.76
//

import { Schema, type, MapSchema } from '@colyseus/schema';
import { Player } from './Player';
import { Card } from './Card';
import { ZoneOrderList } from './ZoneOrderList';
import { Arrow } from './Arrow';
import { Espectador } from './Espectador';

export class RoomState extends Schema {
  @type('string') public roomCode!: string;
  @type('string') public phase!: string;
  @type('number') public turn!: number;
  @type('string') public activePlayerId!: string;
  @type('number') public startedAt!: number;
  @type({ map: Player }) public players: MapSchema<Player> = new MapSchema<Player>();
  @type({ map: Card }) public cards: MapSchema<Card> = new MapSchema<Card>();
  @type({ map: ZoneOrderList }) public zoneOrder: MapSchema<ZoneOrderList> =
    new MapSchema<ZoneOrderList>();
  @type('number') public maxSeats!: number;
  @type('string') public gameType!: string;
  @type('string') public dayNight!: string;
  @type('string') public turnPhase!: string;
  @type({ map: Arrow }) public arrows: MapSchema<Arrow> = new MapSchema<Arrow>();
  @type('string') public nome!: string;
  @type('string') public visibilidade!: string;
  @type('string') public comunicacao!: string;
  @type('string') public idioma!: string;
  @type('number') public nivelDePoder!: number;
  @type('string') public tipoDeMulligan!: string;
  @type('string') public jogadorInicial!: string;
  @type('boolean') public ordemPelosAssentos!: boolean;
  @type('boolean') public sideboardPermitido!: boolean;
  @type('number') public cronometroDeTurno!: number;
  @type('number') public turnoIniciadoEm!: number;
  @type({ map: Espectador }) public espectadores: MapSchema<Espectador> =
    new MapSchema<Espectador>();
}
