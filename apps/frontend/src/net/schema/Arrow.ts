//
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
//
// GENERATED USING @colyseus/schema 3.0.76
//

import { Schema, type } from '@colyseus/schema';

export class Arrow extends Schema {
  @type('string') public id!: string;
  @type('string') public ownerId!: string;
  @type('string') public fromId!: string;
  @type('string') public toId!: string;
  @type('string') public color!: string;
  @type('boolean') public combat!: boolean;
}
