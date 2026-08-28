'use client';

import React from 'react';
import { X, ArrowUpCircle, Hand, Shuffle } from 'lucide-react';
import type { Room } from 'colyseus.js';
import { useGameStore, useUIStore } from '../store/game.store';
import { intents } from '../net/intents';

interface ZoneInspectorProps {
  room: Room<any>;
}

export function ZoneInspector({ room }: ZoneInspectorProps) {
  const inspectedZone = useUIStore(s => s.inspectedZone);
  const setInspectedZone = useUIStore(s => s.setInspectedZone);
  const cardsMap = useGameStore(s => s.cards);
  const cards = Object.values(cardsMap);

  if (!inspectedZone) return null;

  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspectedZone(null);
    };
    window.addEventListener('keydown', handleEsc, true);
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [setInspectedZone]);

  const zoneCards = cards.filter(c => c.zone === inspectedZone && c.ownerId === room.sessionId);

  const handleShuffleAndClose = () => {
    intents.shuffle(room, 'LIBRARY');
    setInspectedZone(null);
  };

  return (
    <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-8 backdrop-blur-sm pointer-events-auto">
      <div className="bg-panel border border-panel-border rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-panel-border bg-panel-hover">
          <h2 className="text-xl font-bold text-text flex items-center gap-2">
            {inspectedZone === 'GRAVEYARD' ? 'Cemitério' : inspectedZone === 'LIBRARY' ? 'Busca no Grimório (Tutor)' : 'Exílio'}
            <span className="text-sm font-normal text-text-muted bg-panel border border-panel-border px-2 py-0.5 rounded-full">
              {zoneCards.length} cartas
            </span>
          </h2>
          
          <div className="flex items-center gap-4">
            {inspectedZone === 'LIBRARY' && (
              <button 
                onClick={handleShuffleAndClose}
                className="bg-primary hover:bg-primary-hover text-white text-sm font-bold px-4 py-2 rounded flex items-center gap-2 transition-colors shadow-lg"
              >
                <Shuffle className="w-4 h-4" />
                Embaralhar e Fechar
              </button>
            )}
            <button 
              onClick={() => setInspectedZone(null)}
              className="p-1 text-text-muted hover:text-white hover:bg-danger/80 rounded transition-colors"
              title="Fechar (Sem embaralhar)"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Grid de Cartas */}
        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar bg-table-deep/50">
          {zoneCards.length === 0 ? (
            <div className="h-full flex items-center justify-center text-text-muted text-lg">
              Nenhuma carta aqui.
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
              {zoneCards.map(card => (
                <div key={card.id} className="group relative flex flex-col items-center">
                  <div className="relative w-full aspect-[0.716] rounded-xl overflow-hidden shadow-lg border border-transparent group-hover:border-primary transition-all">
                    {card.scryfallId ? (
                      <img 
                        src={`https://api.scryfall.com/cards/${card.scryfallId}?format=image&version=normal`} 
                        alt="Card" 
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full bg-[#2c2216]" />
                    )}
                    
                    {/* Ações Overlay */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2 backdrop-blur-[2px]">
                      <button 
                        onClick={() => {
                          intents.changeZone(room, card.id, 'HAND');
                          if (inspectedZone !== 'LIBRARY') setInspectedZone(null);
                        }}
                        className="bg-panel border border-panel-border text-white px-2 py-1.5 rounded flex items-center gap-1.5 hover:bg-primary hover:border-primary transition-colors text-xs w-5/6 justify-center shadow-lg"
                      >
                        <Hand className="w-3.5 h-3.5" />
                        Para Mão
                      </button>
                      <button 
                        onClick={() => {
                          intents.changeZone(room, card.id, 'BATTLEFIELD', window.innerWidth / 2, window.innerHeight / 2);
                          if (inspectedZone !== 'LIBRARY') setInspectedZone(null);
                        }}
                        className="bg-panel border border-panel-border text-white px-2 py-1.5 rounded flex items-center gap-1.5 hover:bg-success hover:border-success transition-colors text-xs w-5/6 justify-center shadow-lg"
                      >
                        <ArrowUpCircle className="w-3.5 h-3.5" />
                        Para Campo
                      </button>
                      {inspectedZone === 'LIBRARY' && (
                        <button 
                          onClick={() => {
                            intents.changeZone(room, card.id, 'COMMAND');
                            setInspectedZone(null);
                          }}
                          className="bg-panel border border-panel-border text-white px-2 py-1.5 rounded flex items-center gap-1.5 hover:bg-warning hover:border-warning transition-colors text-xs w-5/6 justify-center shadow-lg"
                        >
                          <ArrowUpCircle className="w-3.5 h-3.5" />
                          Para Comando
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
