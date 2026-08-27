// 
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
// 
// GENERATED USING @colyseus/schema 3.0.76
// 

import { Schema, type, ArraySchema, MapSchema, SetSchema, DataChange } from '@colyseus/schema';


export class Card extends Schema {
    @type("string") public id!: string;
    @type("string") public ownerId!: string;
    @type("string") public controllerId!: string;
    @type("string") public zone!: string;
    @type("string") public scryfallId!: string;
    @type("string") public revealedTo!: string;
    @type("string") public peekedBy!: string;
    @type("number") public x!: number;
    @type("number") public y!: number;
    @type("number") public rotation!: number;
    @type("number") public zIndex!: number;
    @type("boolean") public isTapped!: boolean;
    @type("boolean") public faceDown!: boolean;
    @type("boolean") public phasedOut!: boolean;
    @type("boolean") public isToken!: boolean;
    @type("boolean") public isCopy!: boolean;
    @type("boolean") public isFlipped!: boolean;
    @type("string") public lockedBy!: string;
    @type("string") public attachedTo!: string;
    @type("string") public exiledBy!: string;
    @type("string") public goadedBy!: string;
    @type("string") public note!: string;
    @type("string") public highlight!: string;
    @type("number") public damage!: number;
    @type("number") public powerOverride!: number;
    @type("number") public toughnessOverride!: number;
    @type({ map: "number" }) public counters: MapSchema<number> = new MapSchema<number>();
}
