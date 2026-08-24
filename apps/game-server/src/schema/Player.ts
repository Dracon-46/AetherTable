import { MapSchema, Schema, type } from '@colyseus/schema';

/**
 * Um jogador sentado na mesa.
 *
 * TODOS os campos de "estado de jogo" aqui sao MARCADORES: o motor exibe, nao
 * impoe (RN01). Vida <= 0 nao elimina ninguem; `INTENT_CONCEDE` marca o jogador
 * como eliminado mas nao o remove da sala.
 *
 * Fonte canonica: docs/especificacao_do_motor_sandbox.md §3.
 */
export class Player extends Schema {
  /** sessionId do Colyseus. */
  @type('string') id!: string;
  /** Id persistente da conta. */
  @type('string') userId!: string;
  @type('string') name!: string;
  @type('string') avatarUrl = '';

  // cosmeticos equipados (DOC-060)
  @type('string') playmatUrl = '';
  @type('string') sleeveUrl = '';
  @type('string') profileBorder = '';
  @type('string') chatTitle = '';

  /** 0..3 — posicao na mesa. */
  @type('number') seat = 0;

  @type('number') life = 40;
  @type('number') poison = 0;
  @type('number') energy = 0;
  @type('number') experience = 0;
  @type('number') commanderTax = 0;
  @type('boolean') isMonarch = false;
  @type('boolean') hasInitiative = false;
  @type('boolean') conceded = false;

  /** Dano de comandante recebido, indexado pelo jogador de origem. */
  @type({ map: 'number' }) commanderDamage = new MapSchema<number>();

  /**
   * Espelhos PUBLICOS de contagem. O jogo exige saber quantas cartas o oponente
   * tem na mao. Redundancia deliberada: e mais simples e mais seguro do que
   * depender do comportamento interno do serializador (DOC-032 §4.2).
   */
  @type('number') handCount = 0;
  @type('number') libraryCount = 0;

  @type('boolean') connected = true;
  /** epoch ms; 0 = conectado. Janela de reconexao: 90 s (RN10). */
  @type('number') disconnectedAt = 0;
}
