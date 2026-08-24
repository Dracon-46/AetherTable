/**
 * UNICA fonte de aleatoriedade do game server (RN06).
 *
 * `Math.random()` e proibido em qualquer outro arquivo deste app — a regra
 * `no-restricted-properties` do ESLint raiz bloqueia isso, e a revisao de PR
 * trata como bloqueante. Motivo: `Math.random()` e um PRNG previsivel. Num jogo
 * onde a ordem do grimorio e informacao oculta valiosa, prever a sequencia e
 * trapaca — e nao ha como auditar depois.
 *
 * Tudo aqui usa `crypto.randomInt`, que consome o CSPRNG do sistema.
 */

import { randomInt } from 'node:crypto';

/** Inteiro em [0, max). */
export function abaixoDe(max: number): number {
  if (!Number.isInteger(max) || max <= 0) {
    throw new RangeError(`abaixoDe espera inteiro positivo, recebeu ${max}`);
  }
  return randomInt(max);
}

/** Inteiro em [min, max], ambos inclusive. */
export function entre(min: number, max: number): number {
  if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
    throw new RangeError(`entre(${min}, ${max}) invalido`);
  }
  return min + randomInt(max - min + 1);
}

/**
 * Fisher-Yates com CSPRNG. Embaralha NO LUGAR e devolve o mesmo array.
 *
 * A variante correta percorre de tras para frente e sorteia em [0, i]. Trocar
 * por `sort(() => rng() - 0.5)` produz distribuicao enviesada — e um erro comum
 * e silencioso.
 */
export function embaralhar<T>(itens: T[]): T[] {
  for (let i = itens.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = itens[i]!;
    itens[i] = itens[j]!;
    itens[j] = tmp;
  }
  return itens;
}

/**
 * Embaralha preservando as `keepTop` primeiras posicoes intactas.
 * Atende `INTENT_SHUFFLE { keepTop }` — "embaralhe o resto, o topo fica".
 */
export function embaralharMantendoTopo<T>(itens: T[], keepTop: number): T[] {
  if (keepTop <= 0) return embaralhar(itens);
  // Topo do grimorio = FIM do array (DOC-032 §2): a stack cresce no fim.
  const corte = Math.max(0, itens.length - keepTop);
  const resto = embaralhar(itens.slice(0, corte));
  const topo = itens.slice(corte);
  return [...resto, ...topo];
}

/** Sorteia um elemento. Devolve `undefined` para array vazio. */
export function sortear<T>(itens: readonly T[]): T | undefined {
  if (itens.length === 0) return undefined;
  return itens[randomInt(itens.length)];
}

/** Rolagem de dado. `sides` ja validado pelo schema Zod da intencao. */
export function rolarDado(sides: number): number {
  return entre(1, sides);
}

/** Cara ou coroa. */
export function girarMoeda(): 'CARA' | 'COROA' {
  return randomInt(2) === 0 ? 'CARA' : 'COROA';
}
