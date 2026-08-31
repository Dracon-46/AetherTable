/**
 * board-type.ts — espelho de `enum BoardType` do Prisma.
 *
 * Os controllers faziam `body.boardType as any` para atravessar a fronteira de
 * tipo: o valor vinha de JSON (string livre) e era empurrado direto para o
 * Prisma. Um `boardType: "LIXO"` chegava ao banco e só falhava lá.
 */
export const BOARD_TYPES = [
  'MAIN',
  'SIDEBOARD',
  'COMMANDER',
  'MAYBEBOARD',
  'SIGNATURE_SPELL',
  'CUBE',
  'PLANAR',
  'SCHEME',
] as const;

export type BoardType = (typeof BOARD_TYPES)[number];

export function ehBoardType(valor: unknown): valor is BoardType {
  return typeof valor === 'string' && (BOARD_TYPES as readonly string[]).includes(valor);
}
