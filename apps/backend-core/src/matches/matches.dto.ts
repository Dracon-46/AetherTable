import { z } from 'zod';

/**
 * matches.dto.ts — validação de borda das rotas de partida.
 *
 * `join` recebia `@Param('roomCode') roomCode: string` e
 * `@Body('deckId') deckId: string`, ambos sem conferência.
 *
 * O `deckId` é o mais direto: a coluna é `@db.Uuid` e o valor ia cru para
 * `prisma.deck.findFirst`. Um id fora do formato faz o Postgres recusar a
 * consulta, e a rota responde 500 em vez de 404 — trocando "não achei seu
 * deck" por "o banco quebrou", que é ao mesmo tempo pior para o jogador e mais
 * informativo para quem está sondando.
 *
 * O `roomCode` é gerado como `randomBytes(3).toString('hex').toUpperCase()`:
 * exatamente seis caracteres hexadecimais. Aceitar qualquer string ali deixava
 * a rota ser usada como sonda — cada tentativa cobrava uma consulta ao banco e
 * uma ida à Scryfall antes de descobrir que a sala não existe.
 */

/** Seis hexadecimais. Aceita minúscula e normaliza — o jogador digita o código. */
export const RoomCodeParam = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-F]{6}$/, 'Código de sala inválido');

/**
 * `deckId` é OPCIONAL: o grimório passou a ser escolhido dentro da sala de
 * espera (`INTENT_SET_DECK`). Continua sendo aceito aqui — quem já sabe com que
 * deck vai jogar não deve ser obrigado a escolher duas vezes — e continua sendo
 * validado como uuid quando vem, porque a coluna é `@db.Uuid` e um valor fora
 * do formato faz o Postgres recusar a consulta: a rota responderia 500 em vez
 * de 404.
 */
export const EntrarNaPartidaDto = z.object({
  deckId: z.string().uuid('deckId precisa ser um UUID').optional(),
});
export type EntrarNaPartidaDto = z.infer<typeof EntrarNaPartidaDto>;
