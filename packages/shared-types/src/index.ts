/**
 * @aethertable/shared-types
 *
 * Fonte unica dos tipos de dominio (ADR-007).
 *
 * REGRA: nunca redefinir um tipo de dominio localmente. Se falta um campo,
 * adicione aqui. Mudar um campo deve QUEBRAR A COMPILACAO de quem nao
 * acompanhou — e exatamente o comportamento desejado.
 */

export * from './zones';
export * from './card';
export * from './player';
export * from './room';
export * from './intents';
export * from './events';
export * from './cards-catalog';
export * from './cosmetics';
