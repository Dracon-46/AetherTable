import { ArraySchema, Schema, type } from '@colyseus/schema';

export class ZoneOrderList extends Schema {
  @type(['string']) items = new ArraySchema<string>();
}
