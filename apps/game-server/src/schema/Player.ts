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

  // ── Cosmeticos equipados (DOC-060) ───────────────────────────────────────
  //
  // Guardam o ID do item no catalogo fechado (packages/shared-types/cosmetics),
  // nunca uma URL. Os nomes anteriores (`playmatUrl`, `sleeveUrl`) prometiam um
  // endereco de imagem — e uma URL vinda do cliente seria upload disfarcado,
  // exatamente o que DOC-060 §1.1 proibe para nao expor a mesa a IP de
  // terceiros e a conteudo sensivel.
  //
  // Renomear campo de Schema e seguro: o serializador do @colyseus/schema usa
  // o INDICE, nao o nome. O mirror do cliente e regenerado por `pnpm schema:sync`.
  @type('string') playmatId = '';
  @type('string') sleeveId = '';
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
  @type('number') mulliganCount = 0;

  @type('boolean') connected = true;
  /** epoch ms; 0 = conectado. Janela de reconexao: 90 s (RN10). */
  @type('number') disconnectedAt = 0;

  // ── CAMPOS NOVOS SEMPRE NO FIM (ver o mesmo aviso em Card.ts) ─────────────

  /** Contadores de jogador restantes de PLAYER_COUNTERS (DOC-036 item 74). */
  @type('number') rad = 0;
  @type('number') ticket = 0;
  /** "Start your engines!" — 0..4 (DOC-036 item 113). */
  @type('number') speed = 0;
  /** "O Anel te tenta" — 0..4 (DOC-036 item 111). */
  @type('number') ringLevel = 0;
  /** `Card.id` da criatura portadora do Anel. */
  @type('string') ringBearerId = '';
  /** DOC-036 item 114. Marcador; o motor nao impoe descarte. */
  @type('number') maxHandSize = 7;

  /** Mascote da mesa. Ver PETS em @aethertable/shared-types. */
  @type('string') petId = '';
}
