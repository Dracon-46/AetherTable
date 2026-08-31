//
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
//
// GENERATED USING @colyseus/schema 3.0.76
//

import { Schema, type, ArraySchema } from '@colyseus/schema';

export class ZoneOrderList extends Schema {
  @type(['string']) public items: ArraySchema<string> = new ArraySchema<string>();
}
