import type { Options } from 'pino-http';

/**
 * registro-http.ts — o que o log de cada requisição NÃO pode guardar.
 *
 * ─── O LOG GUARDAVA AS CHAVES DA CASA ───────────────────────────────────────
 *
 * O `pino-http` registra os cabeçalhos de toda requisição, e sem `redact` eles
 * iam inteiros para o log: o `Authorization: Bearer` de cada sessão, o
 * `x-internal-token` que o game-server manda em toda chamada interna (o mesmo
 * segredo, sempre), e os passes da mesa e da voz. Quem lesse o log — o painel
 * do Render, um serviço de log externo, um print colado num chamado — saía
 * com sessões vivas e com o segredo que abre as rotas internas.
 *
 * Censurar, e não remover: a linha continua dizendo que o cabeçalho VEIO, que
 * é o que se precisa para investigar um 401, sem dizer o que ele continha.
 */

/** Caminhos censurados, na sintaxe do `fast-redact` que o pino usa. */
export const CAMINHOS_CENSURADOS = [
  'req.headers.authorization',
  'req.headers.cookie',
  // O nome que o `InternalApiGuard` lê.
  'req.headers["x-internal-token"]',
  'req.headers["x-passe-de-mesa"]',
  'req.headers["x-passe-de-voz"]',
  'res.headers["set-cookie"]',
];

export const CENSURA = '[redacted]';

export function opcoesDoRegistroHttp(nodeEnv: string | undefined): Options {
  return {
    level: nodeEnv !== 'production' ? 'debug' : 'info',
    redact: { paths: CAMINHOS_CENSURADOS, censor: CENSURA },
    // transport pino-pretty removido para evitar dependência faltante em dev
    // pode ser reativado após: pnpm add pino-pretty --filter backend-core
  };
}
