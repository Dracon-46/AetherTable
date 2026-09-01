import { z } from 'zod';
import { BOARD_TYPES } from './board-type.js';

/**
 * decks.dto.ts — validação de borda das rotas de deck.
 *
 * ─── O QUE ENTRAVA SEM SER OLHADO ──────────────────────────────────────────
 *
 * Nenhuma rota de deck validava nada. `@Body('name') name: string` é só uma
 * ANOTAÇÃO DE TIPO: em runtime o valor é o que o cliente mandou, e TypeScript
 * não checa nada disso. Na prática:
 *
 *   name        podia ser um objeto, um array, ou 10 MB de texto
 *   delta       podia ser `1e308`, `"abc"` ou `NaN`, e ia direto para o banco
 *   scryfallId  qualquer string, buscada na Scryfall sem conferência
 *   decklist    sem teto — e o import fatia em blocos de 75 e chama a Scryfall
 *               a cada bloco, então um corpo grande vira centenas de
 *               requisições saindo do nosso servidor. Um jeito barato de
 *               transformar a API em amplificador de tráfego e de levar um
 *               bloqueio da Scryfall junto.
 *
 * Além disso `:id` e `:cardId` chegavam crus ao Prisma. As colunas são
 * `@db.Uuid`: um id fora do formato faz o Postgres recusar a consulta e a rota
 * responder 500 em vez de 404 — vazando que a falha é do banco. O controller
 * resolve isso com `ParseUUIDPipe`.
 *
 * Não há SQL cru em lugar nenhum do projeto, então injeção de SQL está fechada
 * pelo Prisma. O que estes esquemas fecham é o resto: tipo errado, tamanho sem
 * limite e valor fora de faixa.
 */

/** Scryfall identifica carta por UUID; qualquer outra coisa é lixo. */
const scryfallId = z.string().uuid('scryfallId precisa ser um UUID da Scryfall');

/**
 * Teto do import. 20 KB cobrem com folga um Commander de 100 cartas (~4 KB) e
 * até um cubo de 540 (~22 KB fica de fora de propósito: cubo se monta pela
 * interface, não colando texto). O que isto barra é o corpo de megabytes cuja
 * única função é multiplicar chamadas à Scryfall.
 */
const LIMITE_DECKLIST = 20_000;

export const CriarDeckDto = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  formatId: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(24)
    .regex(/^[a-z0-9-]+$/)
    .optional(),
});
export type CriarDeckDto = z.infer<typeof CriarDeckDto>;

export const AtualizarDeckDto = z.object({
  name: z.string().trim().min(1).max(80),
});
export type AtualizarDeckDto = z.infer<typeof AtualizarDeckDto>;

export const ImportarDeckDto = z.object({
  decklist: z.string().min(1).max(LIMITE_DECKLIST),
});
export type ImportarDeckDto = z.infer<typeof ImportarDeckDto>;

export const AdicionarCartaDto = z.object({
  scryfallId,
  /**
   * 99 é o limite real de um Commander (o deck inteiro menos o comandante).
   * Sem teto, `quantity: 1e9` grava no banco e depois estoura na mesa, ao
   * tentar criar as entidades.
   */
  quantity: z.coerce.number().int().min(1).max(99).optional(),
  boardType: z.enum(BOARD_TYPES).optional(),
});
export type AdicionarCartaDto = z.infer<typeof AdicionarCartaDto>;

export const AtualizarImpressaoDto = z.object({ scryfallId });
export type AtualizarImpressaoDto = z.infer<typeof AtualizarImpressaoDto>;

export const AtualizarQuantidadeDto = z.object({
  /**
   * `int()` recusa `1.5`, `NaN` e `Infinity` — os três chegavam ao Prisma e
   * derrubavam a rota com 500. A faixa é simétrica porque a rota também tira.
   */
  delta: z.coerce.number().int().min(-99).max(99),
});
export type AtualizarQuantidadeDto = z.infer<typeof AtualizarQuantidadeDto>;

export const AtualizarBoardTypeDto = z.object({
  boardType: z.enum(BOARD_TYPES),
});
export type AtualizarBoardTypeDto = z.infer<typeof AtualizarBoardTypeDto>;
