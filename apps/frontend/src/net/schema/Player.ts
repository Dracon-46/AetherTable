// 
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
// 
// GENERATED USING @colyseus/schema 3.0.76
// 

import { Schema, type, ArraySchema, MapSchema, SetSchema, DataChange } from '@colyseus/schema';


export class Player extends Schema {
    @type("string") public id!: string;
    @type("string") public userId!: string;
    @type("string") public name!: string;
    @type("string") public avatarUrl!: string;
    @type("string") public playmatUrl!: string;
    @type("string") public sleeveUrl!: string;
    @type("string") public profileBorder!: string;
    @type("string") public chatTitle!: string;
    @type("number") public seat!: number;
    @type("number") public life!: number;
    @type("number") public poison!: number;
    @type("number") public energy!: number;
    @type("number") public experience!: number;
    @type("number") public commanderTax!: number;
    @type("boolean") public isMonarch!: boolean;
    @type("boolean") public hasInitiative!: boolean;
    @type("boolean") public conceded!: boolean;
    @type({ map: "number" }) public commanderDamage: MapSchema<number> = new MapSchema<number>();
    @type("number") public handCount!: number;
    @type("number") public libraryCount!: number;
    @type("boolean") public connected!: boolean;
    @type("number") public disconnectedAt!: number;
}
