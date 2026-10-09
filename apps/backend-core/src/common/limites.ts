import type { ThrottlerOptions } from '@nestjs/throttler';

/**
 * limites.ts — os baldes globais do rate limit, num lugar só.
 *
 * ─── POR QUE ISTO SAIU DO `app.module.ts` ───────────────────────────────────
 *
 * As rotas internas (o game-server buscando decks e gravando o resumo da
 * partida) precisam ficar FORA destes baldes, e `@SkipThrottle()` sem
 * argumento não faz isso: ele pula só o balde chamado `default`, que aqui não
 * existe. O pulo tem de nomear `curto` e `longo` — e nomes repetidos à mão em
 * dois arquivos divergem no primeiro balde renomeado, devolvendo o 429 em
 * silêncio. Daqui sai a lista E o pulo, derivados um do outro.
 *
 * Os números e o porquê de cada balde estão comentados em `app.module.ts`.
 */
export const BALDES_GLOBAIS = [
  { name: 'curto', ttl: 5_000, limit: 10 },
  { name: 'longo', ttl: 60_000, limit: 120 },
] as const satisfies readonly (ThrottlerOptions & { name: string })[];

/** Argumento de `@SkipThrottle` que tira a rota de TODOS os baldes globais. */
export const SEM_LIMITE_GLOBAL: Record<string, boolean> = Object.fromEntries(
  BALDES_GLOBAIS.map((b) => [b.name, true]),
);
