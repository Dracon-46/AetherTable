'use client';

/**
 * useDecks.ts — leitura e escrita de grimórios, com cache e mutação otimista.
 *
 * ─── O BUG DE DESEMPENHO QUE ESTE ARQUIVO CORRIGE ──────────────────────────
 *
 * Toda ação do deckbuilder terminava em `await fetchDeck()`:
 *
 *     await fetch(PATCH .../quantity)   // 1ª viagem
 *     await fetchDeck()                 // 2ª viagem: o DECK INTEIRO
 *
 * A segunda viagem era a caríssima — `GET /decks/:id` hidratava as 100 cartas
 * na Scryfall a cada chamada, sem cache (ver `decks.service.ts`). Resultado
 * medido da cadeira do usuário: clicar `+1` numa carta levava mais de um
 * segundo para o número mudar na tela, com a interface parada no meio.
 *
 * E era um segundo por clique, em série: ajustar cinco quantidades custava
 * cinco segundos e dez requisições — o suficiente para o throttler de 10 req/5 s
 * responder 429 e a tela simplesmente parar de reagir, sem erro visível.
 *
 * ─── COMO FUNCIONA AGORA ───────────────────────────────────────────────────
 *
 * A mudança é aplicada no CACHE primeiro (`onMutate`), então a tela reflete o
 * clique no mesmo quadro. A requisição sai em paralelo. Se ela falhar, o
 * `onError` devolve o estado anterior — nada de tela mentindo sobre o que foi
 * salvo. A reconciliação com o servidor acontece ao fundo, sem bloquear nada.
 *
 * O que NÃO é otimista: adicionar carta e importar lista. As duas dependem de
 * ids que só o servidor gera, e inventar um id local para depois trocá-lo é
 * como se criam cartas fantasma na tela.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '../store/auth.store';
import { api, mensagemDaApi } from '../lib/fetcher';
import { useToast } from '../components/Toast';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export interface DeckCarta {
  id: string;
  scryfallId: string;
  quantity: number;
  boardType: string;
  /** Campos hidratados pelo servidor a partir da Scryfall. */
  name?: string;
  set?: string;
  typeLine?: string;
  isBanned?: boolean;
  imageNormal?: string;
  priceUsd?: string | number;
  /** Identidade de cor em WUBRG. Alimenta o agrupamento por cor. */
  colorIdentity?: string[];
  /** Custo convertido. `null` quando a Scryfall não devolveu (carta ausente). */
  cmc?: number | null;
  manaCost?: string;
  /** Marca uma carta que ainda não voltou do servidor. Some na reconciliação. */
  pendente?: boolean;
}

export interface DeckResumo {
  id: string;
  name: string;
  formatId: string;
  cardCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DeckCompleto extends DeckResumo {
  cards: DeckCarta[];
}

// ─── Chaves de cache ─────────────────────────────────────────────────────────

export const chavesDeDeck = {
  todos: ['decks'] as const,
  lista: () => ['decks', 'lista'] as const,
  um: (id: string) => ['decks', 'um', id] as const,
};

// ─── Leitura ─────────────────────────────────────────────────────────────────

/**
 * Lista de grimórios. Fica em cache: voltar da tela de um deck para a lista
 * não gera requisição nenhuma dentro do `staleTime`.
 */
export function useListaDeDecks() {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: chavesDeDeck.lista(),
    queryFn: ({ signal }) => api<DeckResumo[]>('/decks', { signal }),
    enabled: Boolean(token),
  });
}

/** Um grimório com as cartas hidratadas. */
export function useDeck(id: string | undefined) {
  const token = useAuthStore((s) => s.accessToken);
  return useQuery({
    queryKey: chavesDeDeck.um(id ?? ''),
    queryFn: ({ signal }) => api<DeckCompleto>(`/decks/${id}`, { signal }),
    enabled: Boolean(token && id),
  });
}

// ─── Utilidades de escrita otimista ──────────────────────────────────────────

/**
 * Aplica uma transformação no deck em cache e devolve o valor anterior para
 * o `onError` poder desfazer.
 *
 * `cancelQueries` antes de mexer não é detalhe: um `GET /decks/:id` em voo que
 * chegasse DEPOIS da escrita otimista sobrescreveria a tela com o estado
 * anterior — o número voltaria sozinho, que é pior do que não ter mudado.
 */
async function escreverOtimista(
  qc: QueryClient,
  deckId: string,
  transformar: (deck: DeckCompleto) => DeckCompleto,
): Promise<{ anterior: DeckCompleto | undefined }> {
  const chave = chavesDeDeck.um(deckId);
  await qc.cancelQueries({ queryKey: chave });
  const anterior = qc.getQueryData<DeckCompleto>(chave);
  if (anterior) qc.setQueryData<DeckCompleto>(chave, transformar(anterior));
  return { anterior };
}

/** Recalcula `cardCount` a partir das cartas — a fonte da verdade local. */
function comContagem(deck: DeckCompleto, cards: DeckCarta[]): DeckCompleto {
  return { ...deck, cards, cardCount: cards.reduce((t, c) => t + c.quantity, 0) };
}

/**
 * Hook interno: devolve o que toda mutação de deck precisa — o cliente de
 * query, o avisador e o par `desfazer`/`reconciliar`.
 */
function useFerramentas(deckId: string) {
  const qc = useQueryClient();
  const avisar = useToast((s) => s.mostrar);

  const desfazer = (
    contexto: { anterior: DeckCompleto | undefined } | undefined,
    erro: unknown,
  ) => {
    if (contexto?.anterior) qc.setQueryData(chavesDeDeck.um(deckId), contexto.anterior);
    avisar(mensagemDaApi(erro), 'erro');
  };

  /**
   * Revalida ao FUNDO. `invalidateQueries` sozinho marca como obsoleto e
   * refaz; a tela já está mostrando o valor certo, então isso é conferência,
   * não carregamento — e é por isso que não há spinner atrelado a ele.
   *
   * A lista também entra: `cardCount` aparece no cartão de cada deck, e sem
   * isto o número na lista ficaria congelado no que era antes da edição.
   */
  const reconciliar = () => {
    void qc.invalidateQueries({ queryKey: chavesDeDeck.um(deckId) });
    void qc.invalidateQueries({ queryKey: chavesDeDeck.lista() });
  };

  return { qc, avisar, desfazer, reconciliar };
}

// ─── Escrita: cartas ─────────────────────────────────────────────────────────

/**
 * Muda a quantidade de uma carta. `delta` de −1 que zera a quantidade remove
 * a carta — o mesmo comportamento do servidor, para a tela não divergir.
 */
export function useMudarQuantidade(deckId: string) {
  const { desfazer, reconciliar } = useFerramentas(deckId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ cardId, delta }: { cardId: string; delta: number }) =>
      api(`/decks/${deckId}/cards/${cardId}/quantity`, { method: 'PATCH', body: { delta } }),

    onMutate: ({ cardId, delta }) =>
      escreverOtimista(qc, deckId, (deck) => {
        const cards = deck.cards
          .map((c) => (c.id === cardId ? { ...c, quantity: c.quantity + delta } : c))
          .filter((c) => c.quantity > 0);
        return comContagem(deck, cards);
      }),

    onError: (erro, _vars, contexto) => desfazer(contexto, erro),
    onSettled: reconciliar,
  });
}

/** Remove a carta inteira do grimório. */
export function useRemoverCarta(deckId: string) {
  const { avisar, desfazer, reconciliar } = useFerramentas(deckId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (cardId: string) => api(`/decks/${deckId}/cards/${cardId}`, { method: 'DELETE' }),

    onMutate: (cardId) =>
      escreverOtimista(qc, deckId, (deck) =>
        comContagem(
          deck,
          deck.cards.filter((c) => c.id !== cardId),
        ),
      ),

    onError: (erro, _vars, contexto) => desfazer(contexto, erro),
    onSuccess: () => avisar('Carta removida do grimório.', 'sucesso'),
    onSettled: reconciliar,
  });
}

/** Promove ou despromove uma carta a comandante. */
export function useAlternarComandante(deckId: string) {
  const { desfazer, reconciliar } = useFerramentas(deckId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({ cardId, boardType }: { cardId: string; boardType: string }) =>
      api(`/decks/${deckId}/cards/${cardId}/board-type`, {
        method: 'PATCH',
        body: { boardType: boardType === 'COMMANDER' ? 'MAIN' : 'COMMANDER' },
      }),

    onMutate: ({ cardId, boardType }) =>
      escreverOtimista(qc, deckId, (deck) => ({
        ...deck,
        cards: deck.cards.map((c) =>
          c.id === cardId
            ? { ...c, boardType: boardType === 'COMMANDER' ? 'MAIN' : 'COMMANDER' }
            : c,
        ),
      })),

    onError: (erro, _vars, contexto) => desfazer(contexto, erro),
    onSettled: reconciliar,
  });
}

/**
 * Adiciona uma carta pela busca.
 *
 * A carta entra na tela como PENDENTE — com o nome que a busca já conhece —
 * em vez de a tela ficar parada esperando o servidor. O `id` real chega na
 * reconciliação; até lá a carta pendente não oferece os botões que dependem
 * dele, porque um `id` inventado viraria um 404 no primeiro clique.
 */
export function useAdicionarCarta(deckId: string) {
  const { avisar, desfazer, reconciliar } = useFerramentas(deckId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      scryfallId,
      quantity,
    }: {
      scryfallId: string;
      quantity: number;
      previa?: Partial<DeckCarta>;
    }) =>
      api(`/decks/${deckId}/cards`, {
        method: 'POST',
        body: { scryfallId, quantity, boardType: 'MAIN' },
      }),

    onMutate: ({ scryfallId, quantity, previa }) =>
      escreverOtimista(qc, deckId, (deck) => {
        const existente = deck.cards.find(
          (c) => c.scryfallId === scryfallId && c.boardType === 'MAIN',
        );
        const cards = existente
          ? deck.cards.map((c) =>
              c.id === existente.id ? { ...c, quantity: c.quantity + quantity } : c,
            )
          : [
              ...deck.cards,
              {
                // Prefixo reconhecível: nenhum handler tenta usá-lo como id
                // de verdade, e ele desaparece na reconciliação.
                id: `pendente:${scryfallId}`,
                scryfallId,
                quantity,
                boardType: 'MAIN',
                pendente: true,
                ...previa,
              } satisfies DeckCarta,
            ];
        return comContagem(deck, cards);
      }),

    onError: (erro, _vars, contexto) => desfazer(contexto, erro),
    onSuccess: () => avisar('Carta adicionada.', 'sucesso'),
    onSettled: reconciliar,
  });
}

// ─── Escrita: o deck ─────────────────────────────────────────────────────────

/** Renomeia. Otimista: o nome é texto local, não depende do servidor. */
export function useRenomearDeck(deckId: string) {
  const { desfazer, reconciliar } = useFerramentas(deckId);
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => api(`/decks/${deckId}`, { method: 'PATCH', body: { name } }),
    onMutate: (name) => escreverOtimista(qc, deckId, (deck) => ({ ...deck, name })),
    onError: (erro, _vars, contexto) => desfazer(contexto, erro),
    onSettled: reconciliar,
  });
}

/** Importa uma decklist de texto. Substitui o conteúdo do grimório. */
export function useImportarLista(deckId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (decklist: string) =>
      api<{ imported: number; notFound?: string[] }>(`/decks/${deckId}/import`, {
        method: 'POST',
        body: { decklist },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chavesDeDeck.um(deckId) });
      void qc.invalidateQueries({ queryKey: chavesDeDeck.lista() });
    },
  });
}

/** Cria um grimório e devolve o registro, para a tela poder navegar até ele. */
export function useCriarDeck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, formatId }: { name: string; formatId: string }) =>
      api<DeckResumo>('/decks', { method: 'POST', body: { name, formatId } }),
    onSuccess: (criado) => {
      // Semeia o cache da lista na hora: a tela do deck novo abre sem esperar.
      qc.setQueryData<DeckResumo[]>(chavesDeDeck.lista(), (antiga) =>
        antiga ? [criado, ...antiga] : [criado],
      );
      void qc.invalidateQueries({ queryKey: chavesDeDeck.lista() });
    },
  });
}

/** Apaga um grimório. Otimista na lista: o cartão sai no mesmo clique. */
export function useApagarDeck() {
  const qc = useQueryClient();
  const avisar = useToast((s) => s.mostrar);

  return useMutation({
    mutationFn: (deckId: string) => api(`/decks/${deckId}`, { method: 'DELETE' }),

    onMutate: async (deckId) => {
      const chave = chavesDeDeck.lista();
      await qc.cancelQueries({ queryKey: chave });
      const anterior = qc.getQueryData<DeckResumo[]>(chave);
      qc.setQueryData<DeckResumo[]>(chave, (lista) => lista?.filter((d) => d.id !== deckId) ?? []);
      return { anterior };
    },

    onError: (erro, _deckId, contexto) => {
      if (contexto?.anterior) qc.setQueryData(chavesDeDeck.lista(), contexto.anterior);
      avisar(mensagemDaApi(erro), 'erro');
    },

    onSuccess: (_dado, deckId) => {
      avisar('Grimório destruído.', 'sucesso');
      qc.removeQueries({ queryKey: chavesDeDeck.um(deckId) });
    },

    onSettled: () => {
      void qc.invalidateQueries({ queryKey: chavesDeDeck.lista() });
    },
  });
}
