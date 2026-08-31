/**
 * Um jogador sentado na mesa.
 * Fonte canonica: docs/especificacao_do_motor_sandbox.md §3.
 *
 * Todos os campos de "estado de jogo" aqui sao MARCADORES: o motor exibe, nao
 * impoe (RN01). Vida <= 0 nao elimina ninguem.
 */
export interface IPlayer {
  /** sessionId do Colyseus — muda a cada conexao. */
  id: string;
  /** Id persistente da conta. */
  userId: string;
  name: string;
  avatarUrl: string;

  /**
   * Cosmeticos equipados (DOC-060). Sao IDs do catalogo fechado — ver
   * `cosmetics.ts`. Nunca URLs: URL vinda do cliente e upload disfarcado.
   */
  playmatId: string;
  sleeveId: string;
  profileBorder: string;
  chatTitle: string;
  petId: string;

  /** Posicao na mesa, 0..3. */
  seat: number;

  life: number;
  poison: number;
  energy: number;
  experience: number;
  commanderTax: number;
  isMonarch: boolean;
  hasInitiative: boolean;

  /** Dano de comandante recebido, indexado pelo jogador de origem. */
  commanderDamage: Record<string, number>;

  /**
   * Espelhos publicos de contagem. O array de cartas em si e filtrado, entao
   * mantemos inteiros redundantes — o jogo exige saber quantas cartas o oponente
   * tem na mao (DOC-032 §4.2).
   */
  handCount: number;
  libraryCount: number;

  connected: boolean;
  /** epoch ms; 0 = conectado. Janela de reconexao: 90 s (RN10). */
  disconnectedAt: number;
}

export const DESIGNATIONS = ['MONARCH', 'INITIATIVE'] as const;
export type Designation = (typeof DESIGNATIONS)[number];

export const PLAYER_COUNTERS = ['POISON', 'ENERGY', 'EXPERIENCE', 'RAD', 'TICKET'] as const;
export type PlayerCounter = (typeof PLAYER_COUNTERS)[number];

export const DAY_NIGHT_VALUES = ['DAY', 'NIGHT', 'NEITHER'] as const;
export type DayNight = (typeof DAY_NIGHT_VALUES)[number];
