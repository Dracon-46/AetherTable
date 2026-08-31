/**
 * Zonas da mesa. A zona determina VISIBILIDADE DE REDE e regras de movimento.
 * Fonte canonica: docs/especificacao_do_motor_sandbox.md §2.
 */
export const ZONES = [
  'BATTLEFIELD',
  'COMMAND',
  'GRAVEYARD',
  'EXILE',
  'HAND',
  'LIBRARY',
  'STACK',
  /**
   * Reserva acessivel na mesa (DOC-036 item 99). Oculta como a mao: so o dono
   * ve. Sem esta zona, `INTENT_FETCH_FROM_SIDEBOARD` nao tem de onde buscar —
   * e o provisionamento de deck mandava as cartas de reserva para o GRIMORIO.
   */
  'SIDEBOARD',
] as const;

export type Zone = (typeof ZONES)[number];

/**
 * Zonas ocultas: a identidade da carta NAO sai do servidor para quem nao tem direito.
 * RN02 / FR-06 / ADR-004.
 */
export const HIDDEN_ZONES: ReadonlySet<Zone> = new Set<Zone>(['HAND', 'LIBRARY', 'SIDEBOARD']);

/** Zonas publicas: conteudo visivel a todos quando a carta esta com a face para cima. */
export const PUBLIC_ZONES: ReadonlySet<Zone> = new Set<Zone>([
  'BATTLEFIELD',
  'GRAVEYARD',
  'EXILE',
  'COMMAND',
  'STACK',
]);

/** Zonas ordenadas: a ordem importa (topo do grimorio, sequencia do cemiterio). */
export const ORDERED_ZONES: ReadonlySet<Zone> = new Set<Zone>([
  'HAND',
  'LIBRARY',
  'GRAVEYARD',
  'EXILE',
  'SIDEBOARD',
]);

/** Zonas que usam coordenadas livres x/y/zIndex. */
export const POSITIONAL_ZONES: ReadonlySet<Zone> = new Set<Zone>(['BATTLEFIELD']);

/** Chave de `RoomState.zoneOrder`: `${playerId}:${zone}`. */
export type ZoneOrderKey = `${string}:${Zone}`;

export function zoneOrderKey(playerId: string, zone: Zone): ZoneOrderKey {
  return `${playerId}:${zone}`;
}
