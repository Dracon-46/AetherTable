import { Schema, type } from '@colyseus/schema';

/**
 * Seta de alvo persistente (DOC-036 item 126).
 *
 * É como se diz "isto ataca aquilo" numa sandbox sem motor de regras: sem
 * setas, declarar ataques em Commander vira conversa no chat. Só marcador
 * visual — o motor não impõe nada (RN01).
 */
export class Arrow extends Schema {
  @type('string') id!: string;
  /** Quem criou. Só o autor (ou um CLEAR_ARROWS) pode remover. */
  @type('string') ownerId!: string;
  /** `Card.id` de origem. */
  @type('string') fromId!: string;
  /** `Card.id` ou `Player.id` de destino. */
  @type('string') toId!: string;
  @type('string') color = '#EF4444';
  /** Setas de combate somem juntas em CLEAR_ARROWS {scope:'COMBAT'}. */
  @type('boolean') combat = false;
}
