'use client';

import React, { useState, useEffect } from 'react';
import { Search, Plus, Loader2 } from 'lucide-react';

interface CardSearchProps {
  onAddCard: (scryfallId: string) => Promise<void>;
}

export function CardSearch({ onAddCard }: CardSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

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
      const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints`);
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
    try {
      await onAddCard(scryfallId);
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="relative mb-4">
        <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
          <Search className="h-4 w-4 text-text-muted" />
        </div>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar carta (ex: 'Sol Ring', 't:goblin')..."
          className="w-full bg-table-deep border border-panel-border rounded-md pl-10 pr-4 py-2 text-text focus:outline-none focus:border-primary transition-colors text-sm"
        />
        {isSearching && (
          <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
            <Loader2 className="h-4 w-4 text-primary animate-spin" />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 custom-scrollbar">
        {results.length === 0 && query.length >= 3 && !isSearching && (
          <div className="text-center text-sm text-text-muted mt-8">
            Nenhuma carta encontrada.
          </div>
        )}

        {results.length === 0 && query.length < 3 && (
          <div className="text-center text-sm text-text-muted mt-8">
            Digite pelo menos 3 letras para buscar na Scryfall.
          </div>
        )}

        {results.map((card) => {
          const imageUri = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small;
          return (
            <div key={card.id} className="flex items-center gap-3 bg-table-deep border border-panel-border p-2 rounded-lg hover:border-primary transition-colors group">
              {imageUri ? (
                <img src={imageUri} alt={card.name} className="w-12 rounded shadow" />
              ) : (
                <div className="w-12 h-16 bg-panel rounded shadow flex items-center justify-center text-[8px] text-center text-text-muted">
                  Sem Imagem
                </div>
              )}
              
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-text truncate" title={card.name}>{card.name}</p>
                <p className="text-xs text-text-faint truncate">{card.type_line}</p>
                <p className="text-[10px] text-primary mt-0.5">[{card.set.toUpperCase()}]</p>
              </div>

              <button
                onClick={() => handleAdd(card.id)}
                disabled={addingId === card.id}
                className="p-2 bg-primary/10 text-primary hover:bg-primary hover:text-white rounded transition-colors disabled:opacity-50"
                title="Adicionar ao Deck"
              >
                {addingId === card.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
