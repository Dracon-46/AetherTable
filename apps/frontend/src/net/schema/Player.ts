//
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
//
// GENERATED USING @colyseus/schema 3.0.76
//

import { Schema, type, MapSchema } from '@colyseus/schema';

export class Player extends Schema {
  @type('string') public id!: string;
  @type('string') public userId!: string;
  @type('string') public name!: string;
  @type('string') public avatarUrl!: string;
  @type('string') public playmatId!: string;
  @type('string') public sleeveId!: string;
  @type('string') public profileBorder!: string;
  @type('string') public chatTitle!: string;
  @type('number') public seat!: number;
  @type('number') public life!: number;
  @type('number') public poison!: number;
  @type('number') public energy!: number;
  @type('number') public experience!: number;
  @type('number') public commanderTax!: number;
  @type('boolean') public isMonarch!: boolean;
  @type('boolean') public hasInitiative!: boolean;
  @type('boolean') public conceded!: boolean;
  @type({ map: 'number' }) public commanderDamage: MapSchema<number> = new MapSchema<number>();
  @type('number') public handCount!: number;
  @type('number') public libraryCount!: number;
  @type('number') public mulliganCount!: number;
  @type('boolean') public connected!: boolean;
  @type('number') public disconnectedAt!: number;
  @type('number') public rad!: number;
  @type('number') public ticket!: number;
  @type('number') public speed!: number;
  @type('number') public ringLevel!: number;
  @type('string') public ringBearerId!: string;
  @type('number') public maxHandSize!: number;
  @type('string') public petId!: string;
  @type('boolean') public ready!: boolean;
  @type('boolean') public keptHand!: boolean;
  @type('string') public deckName!: string;
  @type({ map: 'string' }) public sharedZones: MapSchema<string> = new MapSchema<string>();
  @type('boolean') public eliminated!: boolean;
  @type('string') public eliminationReason!: string;
  @type('boolean') public decked!: boolean;
}
