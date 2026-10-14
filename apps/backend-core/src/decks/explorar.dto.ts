import { z } from 'zod';

/**
 * Filtros do Explorar, vindos da querystring — por isso tudo chega como texto
 * e é convertido aqui (`coerce`), e por isso os tetos: a busca vira um
 * `ILIKE` no banco, e um termo de 10 mil caracteres não é busca, é carga.
 */
export const FiltrosDoExplorarDto = z.object({
  busca: z.string().trim().max(80).optional(),
  formato: z.string().trim().max(32).optional(),
  ordem: z.enum(['curtidos', 'recentes']).default('curtidos'),
  /** "Curtidos por mim": a aba que guarda os decks que a pessoa marcou. */
  curtidos: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  pagina: z.coerce.number().int().min(1).max(1000).default(1),
});
export type FiltrosDoExplorar = z.infer<typeof FiltrosDoExplorarDto>;

export const CurtirDto = z.object({ curtir: z.boolean() });
export type CurtirDto = z.infer<typeof CurtirDto>;
