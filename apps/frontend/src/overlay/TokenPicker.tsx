'use client';

import React, { useState, useEffect } from 'react';
import { Search, Plus, Loader2, X, Ghost } from 'lucide-react';
import { useUIStore } from '../store/game.store';
import { intents } from '../net/intents';
import type { Room } from 'colyseus.js';

interface TokenPickerProps {
  room: Room<any>;
}

export function TokenPicker({ room }: TokenPickerProps) {
  const isActive = useUIStore(s => s.activeModals.tokens);
  const toggleModal = useUIStore(s => s.toggleModal);
  const cameraPos = useUIStore(s => s.cameraPosition);
  const zoomLevel = useUIStore(s => s.zoomLevel);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [creatingId, setCreatingId] = useState<string | null>(null);

  // Busca inicial genérica de tokens comuns
  useEffect(() => {
    if (isActive && results.length === 0 && query === '') {
      performSearch('t:token');
    }
  }, [isActive]);

  useEffect(() => {
    const handler = setTimeout(() => {
      if (query.trim().length >= 2) {
        performSearch(`t:token ${query}`);
      } else if (query.trim() === '') {
        performSearch('t:token');
      }
    }, 500);

    return () => clearTimeout(handler);
  }, [query]);

  const performSearch = async (q: string) => {
    setIsSearching(true);
    try {
      const res = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&order=cmc&dir=asc`);
      if (res.ok) {
        const data = await res.json();
        setResults(data.data?.slice(0, 30) || []);
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

  const handleCreate = (card: any) => {
    setCreatingId(card.id);
    
    // Calcula o centro aproximado da tela atual em relação ao mundo Konva
    const centerX = (window.innerWidth / 2 - cameraPos.x) / zoomLevel;
    const centerY = (window.innerHeight / 2 - cameraPos.y) / zoomLevel;

    intents.createToken(room, {
      scryfallId: card.id,
      name: card.name,
      power: card.power,
      toughness: card.toughness,
      amount: 1,
      x: centerX,
      y: centerY
    });

    setTimeout(() => {
      setCreatingId(null);
      toggleModal('tokens');
    }, 300);
  };

  if (!isActive) return null;

  return (
    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[600px] max-h-[80vh] bg-panel/95 backdrop-blur border border-panel-border rounded-xl shadow-2xl flex flex-col pointer-events-auto z-50 overflow-hidden">
      <div className="flex justify-between items-center p-4 border-b border-panel-border bg-table-deep/50">
        <h3 className="font-bold text-text flex items-center gap-2">
          <Ghost className="w-5 h-5 text-primary" />
          Gerador de Tokens
        </h3>
        <button 
          onClick={() => toggleModal('tokens')}
          className="p-1 hover:bg-danger/20 hover:text-danger rounded transition-colors text-text-muted"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="p-4 border-b border-panel-border">
        <div className="relative">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-text-muted" />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar token por nome ou tipo (ex: 'Zombie', 't:goblin')..."
            className="w-full bg-table-deep border border-panel-border rounded-md pl-10 pr-4 py-2 text-text focus:outline-none focus:border-primary transition-colors text-sm"
            autoFocus
          />
          {isSearching && (
            <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {results.length === 0 && !isSearching ? (
          <div className="text-center text-text-muted py-8 flex flex-col items-center">
            <Ghost className="w-10 h-10 mb-2 opacity-20" />
            Nenhum token encontrado.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {results.map((card) => {
              const imageUri = card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal;
              return (
                <div key={card.id} className="relative group cursor-pointer" onClick={() => handleCreate(card)}>
                  <div className="rounded-lg overflow-hidden border-2 border-transparent group-hover:border-primary transition-colors bg-table-deep aspect-[63/88] flex flex-col items-center justify-center">
                    {imageUri ? (
                      <img src={imageUri} alt={card.name} className="w-full h-full object-cover" loading="lazy" />
                    ) : (
                      <div className="text-center p-2">
                        <span className="font-bold text-xs">{card.name}</span>
                        <span className="text-[10px] block text-text-muted">{card.type_line}</span>
                      </div>
                    )}
                    
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity backdrop-blur-sm">
                      {creatingId === card.id ? (
                        <Loader2 className="w-8 h-8 text-white animate-spin" />
                      ) : (
                        <div className="flex flex-col items-center text-white">
                          <Plus className="w-8 h-8 mb-1" />
                          <span className="text-xs font-bold bg-primary px-2 py-1 rounded">Criar Token</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
