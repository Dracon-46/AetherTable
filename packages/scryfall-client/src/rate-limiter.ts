/**
 * Fila SERIALIZADA de requisicoes a Scryfall.
 *
 * A Scryfall pede explicitamente 50–100 ms entre requisicoes (~10 req/s) e
 * "nunca disparar em paralelo" (DOC-035 §3).
 *
 * NOTA DE IMPLEMENTACAO: o snippet de referencia em DOC-035 §3 usa
 * `lastCall` global sem serializacao. Isso tem uma corrida: N chamadas
 * concorrentes leem o mesmo `lastCall`, calculam a mesma espera e disparam
 * juntas — exatamente o paralelismo que a regra proibe. Aqui a fila e uma
 * cadeia de promessas: cada tarefa so comeca depois que a anterior terminou
 * E o intervalo minimo passou.
 */

const MIN_INTERVAL_MS = 100;

let tail: Promise<unknown> = Promise.resolve();
let lastCallStartedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enfileira `fn`. Garante espacamento de >= 100 ms entre inicios de chamada e
 * que nunca haja duas em voo ao mesmo tempo.
 */
export function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(async () => {
    const elapsed = Date.now() - lastCallStartedAt;
    const wait = MIN_INTERVAL_MS - elapsed;
    if (wait > 0) await sleep(wait);
    lastCallStartedAt = Date.now();
    return fn();
  });

  // A cauda ignora a rejeicao para que um erro nao trave a fila inteira.
  tail = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

/** Tamanho aproximado da fila pendente — alimenta a UI "processando fila". */
let pending = 0;
export function pendingCount(): number {
  return pending;
}

export async function tracked<T>(fn: () => Promise<T>): Promise<T> {
  pending += 1;
  try {
    return await throttled(fn);
  } finally {
    pending -= 1;
  }
}

/** So para testes: zera o estado do modulo. */
export function __resetRateLimiter(): void {
  tail = Promise.resolve();
  lastCallStartedAt = 0;
  pending = 0;
}
