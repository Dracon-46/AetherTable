'use client';

/**
 * PrintingPicker — o seletor de arte de uma carta (F04).
 *
 * ─── ERAM DUAS REQUISIÇÕES EM SÉRIE, NO NAVEGADOR ──────────────────────────
 *
 * A versão anterior fazia a dança inteira do lado do cliente:
 *
 *     const cardRes = await fetch(`/cards/${card.scryfallId}`);   // 1ª viagem
 *     const oracleId = (await cardRes.json()).oracle_id;
 *     await fetch(`/cards/search?q=oracleid:${oracleId}&...`);     // 2ª viagem
 *
 * A segunda nem começava antes da primeira voltar. Abrir o seletor de arte
 * custava dois round-trips completos, e o modal ficava num spinner o tempo
 * todo. `GET /cards/printings/:id` faz as duas do lado do servidor, onde as
 * duas respondem do cache LRU — uma requisição, lista pronta.
 *
 * Esta era a única ideia aproveitável da branch `feat/scryfall-cards-proxy`
 * (de 28/08) que não havia sobrevivido na main. O resto dela já estava aqui,
 * em versão mais completa.
 *
 * ─── E POR QUE A BUSCA AGORA É POR `oracle_id` ─────────────────────────────
 *
 * O `ScryfallClient.printings` buscava por nome exato (`!"Nome"`), o que erra
 * em carta de dupla face — cujo nome canônico é "Frente // Verso" — e mistura
 * impressões quando duas cartas diferentes compartilham nome. `oracle_id` é a
 * identidade da carta, independente de impressão, idioma e face.
 */

import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import { api, mensagemDaApi } from '@/lib/fetcher';
import { cardImageUrl } from '../canvas/textureCache';
import { useToast } from '../components/Toast';
import { chavesDeDeck, type DeckCarta } from './useDecks';
import { useFecharComEsc } from '../overlay/useFecharComEsc';

interface Impressao {
  id: string;
  name: string;
  set: string;
  set_name?: string;
  collector_number: string;
  lang?: string;
}

interface PrintingPickerProps {
  card: DeckCarta;
  deckId: string;
  /** Mantido na assinatura por compatibilidade — o token vem do `fetcher`. */
  accessToken?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function PrintingPicker({ card, deckId, onClose, onSuccess }: PrintingPickerProps) {
  const avisar = useToast((s) => s.mostrar);
  const qc = useQueryClient();
  const [salvando, setSalvando] = useState<string | null>(null);

  useFecharComEsc(true, onClose);

  const { data, isPending, isError, error } = useQuery({
    queryKey: ['cards', 'printings', card.scryfallId],
    queryFn: ({ signal }) =>
      api<{ data?: Impressao[] }>(`/cards/printings/${card.scryfallId}`, {
        signal,
        publica: true,
      }),
    // Impressões de uma carta só mudam quando sai coleção nova.
    staleTime: 60 * 60_000,
  });

  const trocar = useMutation({
    mutationFn: (scryfallId: string) =>
      api(`/decks/${deckId}/cards/${card.id}/printing`, {
        method: 'PATCH',
        body: { scryfallId },
      }),
    onSuccess: () => {
      // A arte na tela vem do `scryfallId` da carta no deck: sem invalidar, o
      // seletor fecharia e a lista continuaria mostrando a impressão antiga.
      void qc.invalidateQueries({ queryKey: chavesDeDeck.um(deckId) });
      onSuccess();
    },
    onError: (erro) => {
      avisar(mensagemDaApi(erro), 'erro');
      setSalvando(null);
    },
  });

  const impressoes = data?.data ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !trocar.isPending) onClose();
      }}
    >
      <div className="bg-panel border-panel-border flex max-h-[85dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border shadow-2xl">
        <div className="border-panel-border bg-table-deep/50 flex items-center justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <h2 className="text-text truncate text-lg font-bold">Selecionar impressão</h2>
            <p className="text-text-muted truncate text-xs">
              {card.name ?? 'Carta'}
              {impressoes.length > 0 && ` · ${impressoes.length} edições`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="hover:bg-danger/20 hover:text-danger text-text-muted shrink-0 rounded p-1 transition-colors"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="custom-scrollbar bg-table-deep flex-1 overflow-y-auto p-4 sm:p-6">
          {isPending ? (
            <div className="text-primary flex h-48 flex-col items-center justify-center">
              <Loader2 className="mb-2 h-8 w-8 animate-spin" />
              <span className="text-sm">Buscando edições…</span>
            </div>
          ) : isError ? (
            <div className="text-danger flex h-48 flex-col items-center justify-center gap-2 text-center">
              <AlertCircle className="h-6 w-6" />
              <span className="text-sm">{mensagemDaApi(error)}</span>
            </div>
          ) : impressoes.length === 0 ? (
            <p className="text-text-muted flex h-48 items-center justify-center text-sm">
              Nenhuma outra impressão encontrada para esta carta.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
              {impressoes.map((impressao) => {
                // Do nosso proxy, não do `image_uris` da resposta — aquele
                // aponta para `cards.scryfall.io`.
                const atual = impressao.id === card.scryfallId;
                const ocupada = salvando === impressao.id;

                return (
                  <button
                    key={impressao.id}
                    type="button"
                    disabled={atual || trocar.isPending}
                    onClick={() => {
                      setSalvando(impressao.id);
                      trocar.mutate(impressao.id);
                    }}
                    className={`relative overflow-hidden rounded-lg border-2 text-left transition-all disabled:cursor-default ${
                      atual
                        ? 'border-primary ring-primary/50 ring-2'
                        : 'hover:border-text-muted border-transparent'
                    } ${trocar.isPending && !ocupada ? 'opacity-40' : ''}`}
                    title={impressao.set_name ?? impressao.set}
                  >
                    <div className="aspect-[63/88] bg-[#1a1a1a]">
                      <img
                        src={cardImageUrl(impressao.id, 'normal')}
                        alt={impressao.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>

                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/80 p-1.5 text-[10px] backdrop-blur-sm">
                      <span className="truncate pr-1 font-bold text-white">
                        {impressao.set?.toUpperCase()}
                      </span>
                      <span className="text-text-muted shrink-0">
                        #{impressao.collector_number}
                      </span>
                    </div>

                    {/* A impressão ATUAL precisa ser reconhecível de relance:
                        sem o selo, o anel azul sozinho se confunde com hover
                        numa grade de vinte artes parecidas. */}
                    {atual && (
                      <span className="bg-primary absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-white shadow">
                        <Check className="h-3 w-3" />
                      </span>
                    )}

                    {ocupada && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                        <Loader2 className="text-primary h-8 w-8 animate-spin" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
