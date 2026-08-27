// 
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
// 
// GENERATED USING @colyseus/schema 3.0.76
// 

import { Schema, type, ArraySchema, MapSchema, SetSchema, DataChange } from '@colyseus/schema';
import { Player } from './Player'
import { Card } from './Card'
import { ZoneOrderList } from './ZoneOrderList'

export class RoomState extends Schema {
    @type("string") public roomCode!: string;
    @type("string") public phase!: string;
    @type("number") public turn!: number;
    @type("string") public activePlayerId!: string;
    @type("number") public startedAt!: number;
    @type({ map: Player }) public players: MapSchema<Player> = new MapSchema<Player>();
    @type({ map: Card }) public cards: MapSchema<Card> = new MapSchema<Card>();
    @type({ map: ZoneOrderList }) public zoneOrder: MapSchema<ZoneOrderList> = new MapSchema<ZoneOrderList>();
}
