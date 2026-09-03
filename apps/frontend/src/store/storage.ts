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

/**
 * ─── POR QUE EXISTE UMA VERSÃO ADIADA ──────────────────────────────────────
 *
 * O middleware `persist` grava a CADA `set`. Não a cada mudança do que é
 * persistido — a cada `set`, qualquer um. No `uiStore` da mesa isso significa:
 *
 *   - `setCamera` roda em `onMouseMove` enquanto o jogador arrasta o fundo;
 *   - `setHoveredCard` roda ao entrar e sair de CADA carta;
 *   - `setZoom` roda a cada tique da roda do mouse.
 *
 * Cada um desses disparava um `JSON.stringify` + uma escrita SINCRONA em
 * `localStorage`, na thread principal, no meio do quadro. Numa mesa de
 * Commander, passar o mouse pelo campo de batalha gerava dezenas de escritas
 * por segundo de um objeto que não tinha mudado em nada — e `localStorage` é
 * a API síncrona mais lenta que uma animação pode encostar.
 *
 * A gravação agora é agrupada: a última chamada dentro da janela vence, e ela
 * sai fora do caminho crítico. Perder o último quadro de pan num fechamento
 * abrupto de aba é irrelevante; travar o arraste não é.
 *
 * `pagehide` fecha a janela do agrupamento: sem ele, sair da mesa logo depois
 * de mexer numa preferência perderia a mudança.
 */
const ATRASO_MS = 400;

function armazenamentoAdiado(destino: Storage): StateStorage {
  const pendentes = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const descarregar = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    for (const [nome, valor] of pendentes) {
      try {
        destino.setItem(nome, valor);
      } catch {
        /* cota cheia ou aba privada: a preferência vale só nesta sessão */
      }
    }
    pendentes.clear();
  };

  if (typeof window !== 'undefined') {
    // `pagehide` e não `beforeunload`: este último é ignorado em navegador
    // móvel, que é justamente onde a aba morre sem aviso.
    window.addEventListener('pagehide', descarregar);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') descarregar();
    });
  }

  return {
    getItem: (nome) => {
      // Lê o pendente primeiro: senão uma releitura logo após a escrita
      // devolveria o valor antigo.
      const naFila = pendentes.get(nome);
      if (naFila !== undefined) return naFila;
      try {
        return destino.getItem(nome);
      } catch {
        return null;
      }
    },
    setItem: (nome, valor) => {
      pendentes.set(nome, valor);
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        descarregar();
      }, ATRASO_MS);
    },
    removeItem: (nome) => {
      pendentes.delete(nome);
      try {
        destino.removeItem(nome);
      } catch {
        /* nada a fazer */
      }
    },
  };
}

/**
 * Igual ao `armazenamentoSeguro`, mas agrupando as escritas.
 *
 * Use nos stores cujo `set` é chamado durante interação contínua (a mesa).
 * Para sessão e autenticação, continue no `armazenamentoSeguro`: ali a escrita
 * é rara e perder a última é inaceitável.
 */
export const armazenamentoAgrupado = createJSONStorage(() =>
  typeof window === 'undefined' ? armazenamentoEmMemoria : armazenamentoAdiado(window.localStorage),
);
