import React from 'react';
import type { Room } from 'colyseus.js';
import { useUIStore, useGameStore } from '../store/game.store';
import { Check, Repeat } from 'lucide-react';
import { intents } from '../net/intents';

interface MulliganModalProps {
  room: Room<any>;
}

export function MulliganModal({ room }: MulliganModalProps) {
  const cards = useGameStore(s => s.cards);
  const { hasKeptHand, setHasKeptHand, mulliganCount, setMulliganCount } = useUIStore();
  const [isSelectingBottom, setIsSelectingBottom] = React.useState(false);
  const [selectedCards, setSelectedCards] = React.useState<string[]>([]);

  const handCards = Object.values(cards).filter(
    (c) => c.ownerId === room.sessionId && c.zone === 'HAND'
  );

  console.log('[MulliganModal] handCards:', handCards.length, handCards);

  // Se o jogador já manteve a mão, ou não tem cartas na mão, esconde
  if (hasKeptHand || handCards.length === 0) return null;

  const handleKeep = () => {
    if (mulliganCount > 0) {
      setIsSelectingBottom(true);
    } else {
      setHasKeptHand(true);
    }
  };

  const handleMulligan = () => {
    setMulliganCount(mulliganCount + 1);
    intents.mulligan(room);
  };

  const toggleCardSelection = (cardId: string) => {
    if (selectedCards.includes(cardId)) {
      setSelectedCards(selectedCards.filter(id => id !== cardId));
    } else if (selectedCards.length < mulliganCount) {
      setSelectedCards([...selectedCards, cardId]);
    }
  };

  const handleConfirmBottom = () => {
    selectedCards.forEach(id => {
      intents.changeZone(room, id, 'LIBRARY', undefined, undefined, 0); // index 0 = bottom
    });
    setHasKeptHand(true);
  };

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm animate-[fadeIn_0.3s_ease-out] pointer-events-auto">
      <div className="text-center mb-8">
        <h1 className="text-5xl font-bold text-white mb-4 shadow-black drop-shadow-lg">
          {isSelectingBottom ? 'London Mulligan' : 'Sua Mão Inicial'}
        </h1>
        <p className="text-xl text-text-muted">
          {isSelectingBottom 
            ? `Selecione ${mulliganCount} carta(s) para devolver ao fundo do grimório.` 
            : 'Você pode manter estas cartas ou realizar um Mulligan.'}
        </p>
      </div>

      <div className="flex gap-4 mb-12 flex-wrap justify-center max-w-7xl px-8">
        {handCards.map((c, idx) => {
          const isSelected = selectedCards.includes(c.id);
          return (
            <div 
              key={c.id} 
              className={`relative group animate-[popIn_0.3s_ease-out] ${isSelectingBottom ? 'cursor-pointer' : ''} ${isSelected ? '-translate-y-8 scale-105' : ''}`} 
              style={{ animationDelay: `${idx * 0.1}s` }}
              onClick={() => isSelectingBottom && toggleCardSelection(c.id)}
            >
              <img 
                src={`https://api.scryfall.com/cards/${c.scryfallId}?format=image&version=normal`} 
                className={`w-48 h-[268px] rounded-xl shadow-[0_0_20px_rgba(0,0,0,0.8)] border transition-all duration-300 ${isSelected ? 'border-primary shadow-primary/50' : 'border-panel-border group-hover:scale-105 group-hover:-translate-y-4'}`}
                alt="Carta da mão inicial"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.parentElement!.querySelector('.fallback-text')?.classList.remove('hidden');
                }}
              />
              <div className="fallback-text hidden absolute inset-0 bg-panel border border-panel-border rounded-xl flex items-center justify-center p-4 text-center break-words text-xs">
                ID: {c.scryfallId || 'VAZIO'}
              </div>
              
              {isSelected && (
                <div className="absolute inset-0 bg-primary/20 rounded-xl flex items-center justify-center border-4 border-primary pointer-events-none">
                  <Check className="w-16 h-16 text-primary drop-shadow-md" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-6">
        {isSelectingBottom ? (
          <button 
            onClick={handleConfirmBottom}
            disabled={selectedCards.length !== mulliganCount}
            className="flex items-center gap-3 px-8 py-4 bg-primary text-white text-2xl font-bold rounded-xl hover:bg-primary-hover hover:scale-105 active:scale-95 transition-all shadow-[0_0_30px_rgba(59,130,246,0.3)] disabled:opacity-50 disabled:pointer-events-none"
          >
            <Check className="w-8 h-8" />
            CONFIRMAR DEVOLUÇÃO ({selectedCards.length}/{mulliganCount})
          </button>
        ) : (
          <>
            <button 
              onClick={handleKeep}
              className="flex items-center gap-3 px-8 py-4 bg-success text-white text-2xl font-bold rounded-xl hover:bg-success-hover hover:scale-105 active:scale-95 transition-all shadow-[0_0_30px_rgba(34,197,94,0.3)]"
            >
              <Check className="w-8 h-8" />
              MANTER MÃO
            </button>
            <button 
              onClick={handleMulligan}
              className="flex items-center gap-3 px-8 py-4 bg-danger text-white text-2xl font-bold rounded-xl hover:bg-danger-hover hover:scale-105 active:scale-95 transition-all shadow-[0_0_30px_rgba(239,68,68,0.3)]"
            >
              <Repeat className="w-8 h-8" />
              MULLIGAN {mulliganCount > 0 ? `(${mulliganCount})` : ''}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
