/**
 * @aethertable/scryfall-client
 *
 * Ponto de acesso UNICO a Scryfall. Nunca chame `api.scryfall.com` de um
 * service: passaria por cima da fila de 100 ms e do User-Agent (DOC-035 §3).
 */
export * from './client';
export { pendingCount } from './rate-limiter';
