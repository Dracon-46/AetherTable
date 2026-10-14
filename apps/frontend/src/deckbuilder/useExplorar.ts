'use client';

/**
 * useExplorar.ts — leitura e escrita do Explorar (decks públicos).
 *
 * Mesmo desenho de `useDecks`: leitura pelo cache do react-query, curtida
 * otimista (o coração acende no clique e volta se o servidor recusar).
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth.store';
import { api, mensagemDaApi } from '../lib/fetcher';
import { useToast } from '../components/Toast';
import { chavesDeDeck, type DeckCompleto, type DeckResumo } from './useDecks';

export interface DeckPublico {
  id: string;
  name: string;
  description: string | null;
  formatId: string;
  commanderId: string | null;
  partnerId: string | null;
  colorIdentity: string[];
  cardCount: number;
  likeCount: number;
  updatedAt: string;
  dono: string;
  curtido: boolean;
}

export interface PaginaDoExplorar {
  total: number;
  pagina: number;
  porPagina: number;
  decks: DeckPublico[];
}

export interface FiltrosDoExplorar {
  busca?: string;
  formato?: string;
  ordem: 'curtidos' | 'recentes';
  curtidos: boolean;
  pagina: number;
}

export type DeckPublicoCompleto = DeckCompleto & {
  dono: string;
  curtido: boolean;
  likeCount: number;
};

const chaves = {
  lista: (f: FiltrosDoExplorar) => ['explorar', 'lista', f] as const,
  um: (id: string) => ['explorar', 'deck', id] as const,
};

export function useListaPublica(filtros: FiltrosDoExplorar) {
  const token = useAuthStore((s) => s.accessToken);
  const qs = new URLSearchParams({
    ordem: filtros.ordem,
    pagina: String(filtros.pagina),
    ...(filtros.busca ? { busca: filtros.busca } : {}),
    ...(filtros.formato ? { formato: filtros.formato } : {}),
    ...(filtros.curtidos ? { curtidos: '1' } : {}),
  });
  return useQuery({
    queryKey: chaves.lista(filtros),
    queryFn: ({ signal }) => api<PaginaDoExplorar>(`/explorar/decks?${qs}`, { signal }),
    enabled: Boolean(token),
    // Trocar de página mantém a anterior na tela até a nova chegar: sem isso a
    // grade sumia e voltava a cada clique em "próxima".
    placeholderData: keepPreviousData,
  });
}

export function useDeckPublico(id: string | undefined) {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: chaves.um(id ?? ''),
    queryFn: ({ signal }) => api<DeckPublicoCompleto>(`/explorar/decks/${id}`, { signal }),
    enabled: Boolean(token && id),
  });
}

/** Curtir/descurtir com o destino explícito — dois cliques não se anulam. */
export function useCurtir() {
  const qc = useQueryClient();
  const avisar = useToast((s) => s.mostrar);

  const aplicar = (deckId: string, curtir: boolean, delta: number) => {
    qc.setQueriesData<PaginaDoExplorar>({ queryKey: ['explorar', 'lista'] }, (pagina) =>
      pagina
        ? {
            ...pagina,
            decks: pagina.decks.map((d) =>
              d.id === deckId ? { ...d, curtido: curtir, likeCount: d.likeCount + delta } : d,
            ),
          }
        : pagina,
    );
    qc.setQueryData<DeckPublicoCompleto>(chaves.um(deckId), (deck) =>
      deck ? { ...deck, curtido: curtir, likeCount: deck.likeCount + delta } : deck,
    );
  };

  return useMutation({
    mutationFn: ({ deckId, curtir }: { deckId: string; curtir: boolean }) =>
      api<{ curtido: boolean; likeCount: number }>(`/explorar/decks/${deckId}/curtir`, {
        method: 'POST',
        body: { curtir },
      }),
    onMutate: ({ deckId, curtir }) => aplicar(deckId, curtir, curtir ? 1 : -1),
    onError: (erro, { deckId, curtir }) => {
      aplicar(deckId, !curtir, curtir ? -1 : 1);
      avisar(mensagemDaApi(erro), 'erro');
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: ['explorar'] }),
  });
}

/** Copia o deck público para os meus decks (nasce privado). */
export function useCopiarPublico() {
  const qc = useQueryClient();
  const avisar = useToast((s) => s.mostrar);
  return useMutation({
    mutationFn: (deckId: string) =>
      api<DeckResumo>(`/explorar/decks/${deckId}/copiar`, { method: 'POST' }),
    onSuccess: (novo) => {
      void qc.invalidateQueries({ queryKey: chavesDeDeck.lista() });
      avisar(`"${novo.name}" está nos seus grimórios.`, 'sucesso');
    },
    onError: (erro) => avisar(mensagemDaApi(erro), 'erro'),
  });
}
