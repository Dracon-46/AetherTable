import { z } from 'zod';
import {
  MAX_DESAFIOS_POR_CONTA,
  MAX_PLACAR_DE_DESAFIO,
  PADRAO_DA_CHAVE_DE_DESAFIO,
} from '@aethertable/shared-types';

/**
 * desafios.dto.ts — a borda do progresso dos desafios.
 *
 * A chave vira chave primária e segmento de URL, então o formato é fechado
 * (`shared-types/desafios.ts`). O placar é inteiro e tem teto: ninguém acerta
 * cem mil seguidas, e um número maior só pode ter sido escrito à mão.
 */

export const ChaveDeDesafioParam = z
  .string()
  .regex(PADRAO_DA_CHAVE_DE_DESAFIO, 'Chave de desafio inválida.');

const placar = z.number().int().min(0).max(MAX_PLACAR_DE_DESAFIO);

/**
 * `PUT /users/me/desafios/:chave`.
 *
 * NÃO há `recorde` aqui, e é de propósito: o recorde é consequência da
 * sequência, calculado no banco (só sobe). Um corpo com `recorde` tem o campo
 * descartado pelo zod — o cliente não escolhe o próprio recorde.
 */
export const RegistrarProgressoDto = z.object({
  sequencia: placar,
  /** Há uma pergunta sorteada e sem resposta. Ver `DesafiosService.registrar`. */
  emJogo: z.boolean(),
});
export type RegistrarProgressoDto = z.infer<typeof RegistrarProgressoDto>;

/**
 * `POST /users/me/desafios/importar`: `{ [chave]: recorde }`, o que o
 * navegador guardava antes de o progresso ir para a conta.
 */
export const ImportarRecordesDto = z
  .record(ChaveDeDesafioParam, placar)
  .refine((mapa) => Object.keys(mapa).length > 0, { message: 'Nada para importar.' })
  .refine((mapa) => Object.keys(mapa).length <= MAX_DESAFIOS_POR_CONTA, {
    message: `No máximo ${MAX_DESAFIOS_POR_CONTA} desafios por conta.`,
  });
export type ImportarRecordesDto = z.infer<typeof ImportarRecordesDto>;
