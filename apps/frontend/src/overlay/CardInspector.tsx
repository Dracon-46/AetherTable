'use client';

import React from 'react';
import { useUIStore } from '../store/game.store';
import { X } from 'lucide-react';

export function CardInspector() {
  const inspectedCardId = useUIStore(s => s.inspectedCardId);
  const setInspectedCard = useUIStore(s => s.setInspectedCard);

  if (!inspectedCardId) return null;

  React.useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInspectedCard(null);
    };
    window.addEventListener('keydown', handleEsc, true); // true para fase capture
    return () => window.removeEventListener('keydown', handleEsc, true);
  }, [setInspectedCard]);

  return (
    <div className="absolute top-0 right-0 h-full w-80 bg-panel/95 backdrop-blur border-l border-panel-border p-4 shadow-2xl flex flex-col pointer-events-auto z-40 transform transition-transform duration-300">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-bold text-text-muted">INSPEÇÃO</h3>
        <button 
          onClick={() => setInspectedCard(null)}
          className="p-1 hover:bg-danger/20 hover:text-danger rounded transition-colors text-text-muted"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
        <div className="relative rounded-xl overflow-hidden shadow-lg border border-[#333] aspect-[63/88] bg-table-deep flex items-center justify-center">
          <img 
            src={`https://api.scryfall.com/cards/${inspectedCardId}?format=image&version=normal`}
            alt="Card"
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
        
        {/* Additional information could be fetched and displayed here in the future */}
        <div className="mt-4 p-3 bg-table-deep border border-panel-border rounded-lg">
          <p className="text-xs text-text-muted text-center">
            Pressione <kbd className="bg-panel px-1 py-0.5 rounded border border-panel-border text-text">Esc</kbd> para fechar.
          </p>
        </div>
      </div>
    </div>
  );
}
