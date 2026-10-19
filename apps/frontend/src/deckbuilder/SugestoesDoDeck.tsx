'use client';

/**
 * SugestoesDoDeck.tsx — cartas recomendadas pelo comandante do deck.
 *
 * O servidor lê o tema do comandante (tribo, mecânicas) e a identidade de cor
 * dele e devolve, por papel, o que mais se joga nessas cores e o deck ainda
 * não tem. Ver `gerador/sugestoes.service.ts` no backend.
 *
 * A consulta só sai quando a aba abre: são até cinco buscas na Scryfall, e
 * quem só veio ajustar quantidades não precisa delas.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Crown, Loader2, Plus, Sparkles } from 'lucide-react';
import { cardImageUrl } from '@/canvas/textureCache';
import { api, mensagemDaApi } from '../lib/fetcher';

export interface CartaSugerida {
  scryfallId: string;
  name: string;
  typeLine: string;
  manaCost: string;
  gameChanger: boolean;
}

export interface SugestoesDeCartas {
  comandantes: string[];
  temas: string[];
  grupos: { papel: string; nome: string; cartas: CartaSugerida[] }[];
}

export function useSugestoes(deckId: string, comandantes: string) {
  return useQuery({
    // Os comandantes entram na chave: trocar o comandante muda o tema e a
    // identidade, e a sugestão anterior deixa de valer.
    queryKey: ['decks', deckId, 'sugestoes', comandantes],
    queryFn: ({ signal }) => api<SugestoesDeCartas>(`/decks/${deckId}/sugestoes`, { signal }),
    staleTime: 5 * 60_000,
  });
}

export function SugestoesDoDeck({
  deckId,
  comandantes,
  onAddCard,
}: {
  deckId: string;
  /** Ids dos comandantes atuais, juntos — muda a chave da consulta. */
  comandantes: string;
  onAddCard: (scryfallId: string, quantity: number) => Promise<void>;
}) {
  const { data, isPending, isError, error } = useSugestoes(deckId, comandantes);
  // O que foi adicionado AGORA some da lista sem esperar nova consulta.
  const [adicionadas, setAdicionadas] = useState<ReadonlySet<string>>(new Set());
  const [adicionando, setAdicionando] = useState<string | null>(null);

  const adicionar = async (scryfallId: string) => {
    setAdicionando(scryfallId);
    try {
      await onAddCard(scryfallId, 1);
      setAdicionadas((antes) => new Set(antes).add(scryfallId));
    } catch {
      // Quem avisa a pessoa e desfaz a carta otimista é o `onError` da mutação.
    } finally {
      setAdicionando(null);
    }
  };

  if (!comandantes) {
    return (
      <p className="text-text-muted mt-8 px-2 text-center text-sm">
        <Crown className="text-primary mx-auto mb-2 h-6 w-6" />
        As sugestões partem do comandante. Marque uma carta como comandante (a coroa na lista) para
        ver o que combina com ela.
      </p>
    );
  }

  if (isPending) {
    return (
      <p className="text-text-muted mt-8 flex items-center justify-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Lendo o comandante…
      </p>
    );
  }

  if (isError) {
    return (
      <div className="border-danger/30 bg-danger/10 text-danger flex items-start gap-2 rounded-md border p-3 text-sm">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{mensagemDaApi(error)}</span>
      </div>
    );
  }

  const grupos = data.grupos
    .map((g) => ({ ...g, cartas: g.cartas.filter((c) => !adicionadas.has(c.scryfallId)) }))
    .filter((g) => g.cartas.length > 0);

  return (
    <div className="custom-scrollbar flex-1 space-y-5 overflow-y-auto pr-1">
      {data.temas.length > 0 && (
        <div className="text-text-muted flex flex-wrap items-center gap-1.5 text-xs">
          <Sparkles className="text-primary h-3.5 w-3.5" />
          Tema lido do comandante:
          {data.temas.map((t) => (
            <span key={t} className="bg-primary/10 text-primary rounded px-1.5 py-0.5">
              {t}
            </span>
          ))}
        </div>
      )}

      {grupos.length === 0 && (
        <p className="text-text-muted mt-8 text-center text-sm">
          Nada a sugerir: o deck já tem o que mais se joga com esse comandante.
        </p>
      )}

      {grupos.map((g) => (
        <section key={g.papel}>
          <h3 className="text-text-muted mb-2 text-xs font-semibold uppercase tracking-wider">
            {g.nome}
          </h3>
          <ul className="space-y-2">
            {g.cartas.map((c) => (
              <li
                key={c.scryfallId}
                className="bg-table-deep border-panel-border hover:border-primary flex items-center gap-3 rounded-lg border p-2 transition-colors"
              >
                <img
                  src={cardImageUrl(c.scryfallId, 'small')}
                  alt=""
                  className="aspect-[5/7] w-10 shrink-0 rounded bg-black/20 object-cover shadow"
                  loading="lazy"
                  decoding="async"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-text truncate text-sm font-semibold" title={c.name}>
                    {c.name}
                  </p>
                  <p className="text-text-faint truncate text-xs">{c.typeLine}</p>
                  {c.gameChanger && (
                    <p
                      className="text-warning text-[10px] font-semibold"
                      title="Está na lista de Game Changers: pode subir o bracket do deck"
                    >
                      Game Changer
                    </p>
                  )}
                </div>
                <button
                  onClick={() => void adicionar(c.scryfallId)}
                  disabled={adicionando === c.scryfallId}
                  className="bg-primary/10 text-primary hover:bg-primary shrink-0 rounded p-1.5 transition-colors hover:text-white disabled:opacity-50"
                  title="Adicionar ao deck"
                  aria-label={`Adicionar ${c.name} ao deck`}
                >
                  {adicionando === c.scryfallId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
