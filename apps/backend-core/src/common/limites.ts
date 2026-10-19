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

type NomeDoBalde = (typeof BALDES_GLOBAIS)[number]['name'];

/**
 * ─── ROTAS QUE ACOMPANHAM UM JOGO EM CURSO ──────────────────────────────────
 *
 * O progresso dos desafios grava DUAS vezes por pergunta: ao sortear (há
 * pergunta aberta) e ao responder. No "qual é mais cara?" uma pessoa rápida
 * responde em menos de um segundo, e o balde curto global (10 em 5 s, contado
 * por rota) a pararia no quinto par — o recorde daquela resposta não chegaria
 * à conta, e a tela não diria nada.
 *
 * Os MESMOS baldes, com mais folga, e não `@SkipThrottle`: a rota continua
 * autenticada e contada, só não confunde jogo rápido com rajada de script. O
 * tipo amarra os nomes aos de `BALDES_GLOBAIS` — renomear um balde lá quebra a
 * compilação aqui, em vez de deixar esta rota no limite global em silêncio.
 */
export const LIMITE_DE_JOGO_EM_CURSO: Record<NomeDoBalde, { limit: number; ttl: number }> = {
  curto: { limit: 30, ttl: 5_000 },
  longo: { limit: 300, ttl: 60_000 },
};

/** Argumento de `@SkipThrottle` que tira a rota de TODOS os baldes globais. */
export const SEM_LIMITE_GLOBAL: Record<string, boolean> = Object.fromEntries(
  BALDES_GLOBAIS.map((b) => [b.name, true]),
);
