import { z } from 'zod';

/** Limite do endpoint `POST /cards/collection` da Scryfall. */
const MAX_IDENTIFICADORES = 75;

/**
 * Corpo da hidratação de catálogo.
 *
 * O teto de 75 não é decoração: sem ele, um POST com dez mil ids faria o
 * `ScryfallClient` fatiar em 134 lotes e ocupar a fila global de 100 ms por
 * treze segundos — uma requisição derrubando a busca de todo mundo.
 */
export const ColecaoDto = z.object({
  identifiers: z
    .array(
      z
        .object({
          id: z.string().uuid().optional(),
          name: z.string().min(1).max(200).optional(),
          set: z.string().min(1).max(10).optional(),
        })
        .refine((i) => Boolean(i.id ?? i.name), {
          message: 'Cada identificador precisa de `id` ou `name`.',
        }),
    )
    .min(1)
    .max(MAX_IDENTIFICADORES),
});

export type ColecaoDto = z.infer<typeof ColecaoDto>;
