/**
 * storage.ts — armazenamento persistente seguro para SSR.
 *
 * ─── O BUG QUE ESTE ARQUIVO CORRIGE ────────────────────────────────────────
 *
 * O middleware `persist` do zustand só instala a API `store.persist`
 * (`hasHydrated`, `onFinishHydration`, `rehydrate`…) SE conseguir resolver um
 * storage. Sem `storage` explícito ele tenta `localStorage`, que não existe no
 * Node — então, durante o `next build` (prerender) e em qualquer render de
 * servidor, `useAuthStore.persist` era `undefined`.
 *
 * O sintoma era o build inteiro morrer:
 *
 *     Error occurred prerendering page "/dashboard/decks"
 *     TypeError: Cannot read properties of undefined (reading 'hasHydrated')
 *
 * A correção é dar ao `persist` um storage em memória quando não há `window`.
 * No servidor ele nunca guarda nada de útil (cada request começa vazio, que é
 * exatamente o que queremos: sessão é coisa de cliente), mas a API existe e o
 * código que espera a reidratação para de quebrar.
 */

import { createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';

const memoria = new Map<string, string>();

const armazenamentoEmMemoria: StateStorage = {
  getItem: (nome) => memoria.get(nome) ?? null,
  setItem: (nome, valor) => {
    memoria.set(nome, valor);
  },
  removeItem: (nome) => {
    memoria.delete(nome);
  },
};

/** `localStorage` no navegador; um Map descartável no servidor. */
export const armazenamentoSeguro = createJSONStorage(() =>
  typeof window === 'undefined' ? armazenamentoEmMemoria : window.localStorage,
);
