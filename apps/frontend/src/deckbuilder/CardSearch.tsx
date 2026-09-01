'use client';

import React, { useState, useEffect } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';
import { API_URL } from '@/lib/api';
import { cardImageUrl } from '../canvas/textureCache';

interface CardSearchProps {
  onAddCard: (scryfallId: string, quantity: number) => Promise<void>;
}

export function CardSearch({ onAddCard }: CardSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  useEffect(() => {
    const handler = setTimeout(() => {
      if (query.trim().length >= 3) {
        performSearch(query);
      } else {
        setResults([]);
      }
    }, 500);

    return () => clearTimeout(handler);
  }, [query]);

  const performSearch = async (q: string) => {
    setIsSearching(true);
    try {
      // Espelho do backend, não `api.scryfall.com`: numa rede que filtra o
      // domínio da Scryfall, a busca do navegador nem chega a sair.
      const res = await fetch(`${API_URL}/cards/search?q=${encodeURIComponent(q)}&unique=prints`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.data?.slice(0, 20) || []);
      } else {
        setResults([]);
      }
    } catch (e) {
      console.error(e);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAdd = async (scryfallId: string) => {
    setAddingId(scryfallId);
    const qty = quantities[scryfallId] || 1;
    try {
      await onAddCard(scryfallId, qty);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="relative mb-4">
        <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">
          <Search className="text-text-muted h-4 w-4" />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar carta (ex: 'Sol Ring', 't:goblin')..."
          className="bg-table-deep border-panel-border text-text focus:border-primary w-full rounded-md border py-2 pl-10 pr-4 text-sm transition-colors focus:outline-none"
        />
        {isSearching && (
          <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
            <Loader2 className="text-primary h-4 w-4 animate-spin" />
          </div>
        )}
      </div>

      <div className="custom-scrollbar flex-1 space-y-2 overflow-y-auto">
        {results.length === 0 && query.length >= 3 && !isSearching && (
          <div className="text-text-muted mt-8 text-center text-sm">Nenhuma carta encontrada.</div>
        )}

        {results.length === 0 && query.length < 3 && (
          <div className="text-text-muted mt-8 text-center text-sm">
            Digite pelo menos 3 letras para buscar na Scryfall.
          </div>
        )}

        {results.map((card) => {
          // A URL vem do nosso proxy, não do `image_uris` da resposta: aquele
          // campo aponta para `cards.scryfall.io`, que é justamente o domínio
          // que o navegador pode não alcançar.
          const imageUri = card.id ? cardImageUrl(card.id, 'small') : null;
          return (
            <div
              key={card.id}
              className="bg-table-deep border-panel-border hover:border-primary group flex items-center gap-3 rounded-lg border p-2 transition-colors"
            >
              {imageUri ? (
                <img src={imageUri} alt={card.name} className="w-12 rounded shadow" />
              ) : (
                <div className="bg-panel text-text-muted flex h-16 w-12 items-center justify-center rounded text-center text-[8px] shadow">
                  Sem Imagem
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="text-text truncate text-sm font-semibold" title={card.name}>
                  {card.name}
                </p>
                <p className="text-text-faint truncate text-xs">{card.type_line}</p>
                <p className="text-primary mt-0.5 text-[10px]">[{card.set.toUpperCase()}]</p>
              </div>

              <div className="flex flex-col items-end gap-1">
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={quantities[card.id] || 1}
                  onChange={(e) =>
                    setQuantities((prev) => ({ ...prev, [card.id]: parseInt(e.target.value) || 1 }))
                  }
                  className="bg-panel border-panel-border text-text focus:border-primary w-12 rounded border py-1 text-center text-xs focus:outline-none"
                />
                <button
                  onClick={() => handleAdd(card.id)}
                  disabled={addingId === card.id}
                  className="bg-primary/10 text-primary hover:bg-primary flex w-full items-center justify-center rounded p-1.5 transition-colors hover:text-white disabled:opacity-50"
                  title="Adicionar ao Deck"
                >
                  {addingId === card.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
